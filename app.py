"""
邪王真翔的背单词小工具 — Flask Backend
"""
import json
import os
import re
import sqlite3
import time
from datetime import datetime, date, timedelta
from functools import wraps

import bcrypt
from flask import Flask, request, jsonify, session, g, send_from_directory

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.secret_key = os.urandom(24).hex()
DATABASE = "vocab.db"


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
    db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            avatar_color TEXT DEFAULT '#6366f1',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS words (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            english TEXT NOT NULL,
            chinese TEXT NOT NULL,
            phonetic TEXT DEFAULT '',
            category TEXT NOT NULL DEFAULT 'custom'
        );

        CREATE TABLE IF NOT EXISTS user_words (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            word_id INTEGER NOT NULL,
            ease_factor REAL DEFAULT 2.5,
            interval INTEGER DEFAULT 0,
            repetitions INTEGER DEFAULT 0,
            next_review DATE DEFAULT (date('now')),
            last_review DATE,
            correct_count INTEGER DEFAULT 0,
            wrong_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'new',
            is_favorite INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (word_id) REFERENCES words(id),
            UNIQUE(user_id, word_id)
        );

        CREATE TABLE IF NOT EXISTS study_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            mode TEXT NOT NULL,
            category TEXT DEFAULT 'all',
            words_count INTEGER DEFAULT 0,
            correct_count INTEGER DEFAULT 0,
            wrong_count INTEGER DEFAULT 0,
            duration_sec INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS daily_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date DATE NOT NULL,
            words_learned INTEGER DEFAULT 0,
            words_reviewed INTEGER DEFAULT 0,
            time_spent_sec INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, date)
        );

        CREATE TABLE IF NOT EXISTS user_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE NOT NULL,
            daily_goal INTEGER DEFAULT 20,
            theme TEXT DEFAULT 'dark',
            reminder_enabled INTEGER DEFAULT 0,
            reminder_time TEXT DEFAULT '09:00',
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS achievements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            achievement_key TEXT NOT NULL,
            unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, achievement_key)
        );

        CREATE INDEX IF NOT EXISTS idx_user_words_next ON user_words(user_id, next_review);
        CREATE INDEX IF NOT EXISTS idx_words_category ON words(category);
        CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(user_id, date);
    """)
    db.commit()
    db.close()


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "请先登录"}), 401
        return f(*args, **kwargs)
    return decorated


def load_words_to_db(category):
    """Load JSON word list into SQLite database."""
    db = get_db()
    path = f"data/words/{category}.json"
    if not os.path.exists(path):
        return 0
    with open(path, "r", encoding="utf-8") as f:
        words = json.load(f)
    count = 0
    for w in words:
        english = w["english"].strip().lower()
        chinese = w.get("chinese", "")
        phonetic = w.get("phonetic", "")
        existing = db.execute(
            "SELECT id FROM words WHERE english=? AND category=?",
            (english, category)
        ).fetchone()
        if not existing:
            db.execute(
                "INSERT INTO words (english, chinese, phonetic, category) VALUES (?,?,?,?)",
                (english, chinese, phonetic, category)
            )
            count += 1
    db.commit()
    return count


def get_or_create_user_words(user_id, word_ids):
    """Ensure user_words records exist for given word IDs."""
    db = get_db()
    placeholders = ",".join("?" * len(word_ids))
    existing = db.execute(
        f"SELECT word_id FROM user_words WHERE user_id=? AND word_id IN ({placeholders})",
        [user_id] + word_ids
    ).fetchall()
    existing_ids = {r["word_id"] for r in existing}
    new_ids = [wid for wid in word_ids if wid not in existing_ids]
    for wid in new_ids:
        db.execute(
            "INSERT INTO user_words (user_id, word_id) VALUES (?,?)",
            (user_id, wid)
        )
    db.commit()
    return len(new_ids)

# --- SM-2 Spaced Repetition Algorithm ---
def sm2_update(ease_factor, interval, repetitions, quality):
    """
    quality: 0=wrong, 1=hard, 2=good, 3=easy
    Returns (new_ease_factor, new_interval, new_repetitions, next_review_date)
    """
    if quality == 0:  # wrong
        new_ef = max(1.3, ease_factor - 0.3)
        new_interval = 1
        new_reps = 0
    elif quality == 1:  # hard
        new_ef = max(1.3, ease_factor - 0.15)
        new_interval = max(1, int(interval * 1.2))
        new_reps = repetitions + 1
    elif quality == 2:  # good
        new_ef = ease_factor + 0.1
        if repetitions == 0:
            new_interval = 1
        elif repetitions == 1:
            new_interval = 3
        else:
            new_interval = int(interval * ease_factor)
        new_reps = repetitions + 1
    else:  # easy (3)
        new_ef = ease_factor + 0.15
        if repetitions == 0:
            new_interval = 3
        elif repetitions == 1:
            new_interval = 7
        else:
            new_interval = int(interval * ease_factor * 1.3)
        new_reps = repetitions + 1

    next_review = (date.today() + timedelta(days=new_interval)).isoformat()
    return new_ef, new_interval, new_reps, next_review


# ==================== API Routes ====================

# --- Auth ---
@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json()
    username = (data.get("username") or "").strip()
    email = (data.get("email") or "").strip()
    password = (data.get("password") or "").strip()

    if not username or not email or not password:
        return jsonify({"error": "用户名、邮箱、密码不能为空"}), 400
    if len(username) < 2 or len(username) > 20:
        return jsonify({"error": "用户名 2-20 个字符"}), 400
    if len(password) < 6:
        return jsonify({"error": "密码至少 6 位"}), 400
    if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
        return jsonify({"error": "邮箱格式不正确"}), 400

    db = get_db()
    existing = db.execute(
        "SELECT id FROM users WHERE username=? OR email=?",
        (username, email)
    ).fetchone()
    if existing:
        return jsonify({"error": "用户名或邮箱已被注册"}), 409

    pwd_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())
    db.execute(
        "INSERT INTO users (username, email, password_hash) VALUES (?,?,?)",
        (username, email, pwd_hash)
    )
    db.commit()
    user = db.execute(
        "SELECT id FROM users WHERE username=?", (username,)
    ).fetchone()
    db.execute(
        "INSERT INTO user_settings (user_id) VALUES (?)", (user["id"],)
    )
    db.commit()
    session["user_id"] = user["id"]
    session["username"] = username
    return jsonify({"ok": True, "user_id": user["id"], "username": username})


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json()
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()

    if not username or not password:
        return jsonify({"error": "用户名和密码不能为空"}), 400

    db = get_db()
    user = db.execute(
        "SELECT * FROM users WHERE username=? OR email=?",
        (username, username)
    ).fetchone()

    if not user:
        return jsonify({"error": "用户不存在"}), 404

    if not bcrypt.checkpw(password.encode("utf-8"), user["password_hash"]):
        return jsonify({"error": "密码错误"}), 401

    db.execute(
        "UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=?",
        (user["id"],)
    )
    db.commit()
    session["user_id"] = user["id"]
    session["username"] = user["username"]
    return jsonify({
        "ok": True,
        "user_id": user["id"],
        "username": user["username"],
        "email": user["email"]
    })


@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/me")
@login_required
def me():
    db = get_db()
    user = db.execute(
        "SELECT id, username, email, avatar_color, created_at FROM users WHERE id=?",
        (session["user_id"],)
    ).fetchone()
    settings = db.execute(
        "SELECT * FROM user_settings WHERE user_id=?",
        (session["user_id"],)
    ).fetchone()

    total_words = db.execute(
        "SELECT COUNT(*) as c FROM user_words WHERE user_id=?",
        (session["user_id"],)
    ).fetchone()["c"]

    today = date.today().isoformat()
    due_today = db.execute(
        "SELECT COUNT(*) as c FROM user_words WHERE user_id=? AND next_review<=?",
        (session["user_id"], today)
    ).fetchone()["c"]

    mastered = db.execute(
        "SELECT COUNT(*) as c FROM user_words WHERE user_id=? AND status='mastered'",
        (session["user_id"],)
    ).fetchone()["c"]

    # Streak
    streak = 0
    check_date = date.today()
    while True:
        stat = db.execute(
            "SELECT id FROM daily_stats WHERE user_id=? AND date=?",
            (session["user_id"], check_date.isoformat())
        ).fetchone()
        if stat:
            streak += 1
            check_date -= timedelta(days=1)
        else:
            break
    # Check if today has stats, if not, yesterday's streak counts
    today_stat = db.execute(
        "SELECT id FROM daily_stats WHERE user_id=? AND date=?",
        (session["user_id"], today)
    ).fetchone()
    if not today_stat and streak > 0:
        pass  # streak already counted from yesterday

    return jsonify({
        "user": dict(user),
        "settings": dict(settings) if settings else {},
        "total_words": total_words,
        "due_today": due_today,
        "mastered": mastered,
        "streak": streak
    })


# --- Words ---
@app.route("/api/words")
@login_required
def list_words():
    category = request.args.get("category", "")
    search = request.args.get("search", "").strip()
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 50))

    db = get_db()
    conditions = ["1=1"]
    params = []

    if category:
        conditions.append("w.category=?")
        params.append(category)
    if search:
        conditions.append("(w.english LIKE ? OR w.chinese LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%"])

    where = " AND ".join(conditions)

    total = db.execute(
        f"SELECT COUNT(*) as c FROM words w WHERE {where}", params
    ).fetchone()["c"]

    offset = (page - 1) * per_page
    rows = db.execute(
        f"SELECT w.*, uw.status, uw.is_favorite, uw.correct_count, uw.wrong_count "
        f"FROM words w "
        f"LEFT JOIN user_words uw ON w.id=uw.word_id AND uw.user_id=? "
        f"WHERE {where} "
        f"ORDER BY w.english LIMIT ? OFFSET ?",
        [session["user_id"]] + params + [per_page, offset]
    ).fetchall()

    return jsonify({
        "words": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "per_page": per_page
    })


@app.route("/api/words/categories")
def word_categories():
    db = get_db()
    rows = db.execute(
        "SELECT category, COUNT(*) as count FROM words GROUP BY category ORDER BY category"
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/words/import", methods=["POST"])
@login_required
def import_words():
    """Import custom words from JSON, CSV, or TXT."""
    data = request.get_json()
    words_data = data.get("words", [])
    category = data.get("category", "custom")

    if not words_data:
        return jsonify({"error": "没有单词数据"}), 400

    db = get_db()
    added = 0
    for item in words_data:
        english = (item.get("english") or item.get("word") or "").strip().lower()
        chinese = (item.get("chinese") or item.get("meaning") or item.get("definition") or "").strip()
        phonetic = (item.get("phonetic") or item.get("phonetic") or "").strip()
        if not english or not chinese:
            continue
        existing = db.execute(
            "SELECT id FROM words WHERE english=? AND category=?",
            (english, category)
        ).fetchone()
        if not existing:
            db.execute(
                "INSERT INTO words (english, chinese, phonetic, category) VALUES (?,?,?,?)",
                (english, chinese, phonetic, category)
            )
            added += 1
    db.commit()
    return jsonify({"ok": True, "added": added})


# --- Study ---
@app.route("/api/study/due")
@login_required
def study_due():
    """Get words due for review today + new words to learn."""
    category = request.args.get("category", "")
    limit = int(request.args.get("limit", 20))
    mode = request.args.get("mode", "flashcard")  # flashcard, choice, spelling, listen

    db = get_db()
    today = date.today().isoformat()

    # Due review words
    conditions = ["uw.user_id=?", "uw.next_review<=?"]
    params = [session["user_id"], today]
    if category:
        conditions.append("w.category=?")
        params.append(category)

    where = " AND ".join(conditions)
    review_words = db.execute(
        f"SELECT w.*, uw.ease_factor, uw.interval, uw.repetitions, uw.status, "
        f"uw.correct_count, uw.wrong_count FROM words w "
        f"JOIN user_words uw ON w.id=uw.word_id "
        f"WHERE {where} ORDER BY uw.next_review ASC LIMIT ?",
        params + [limit]
    ).fetchall()

    result = [dict(r) for r in review_words]

    # If not enough review words, add new words
    if len(result) < limit:
        new_limit = limit - len(result)
        existing_ids = [r["id"] for r in review_words]
        if existing_ids:
            id_placeholders = ",".join("?" * len(existing_ids))
            new_conditions = conditions + [f"w.id NOT IN ({id_placeholders})"]
        else:
            new_conditions = conditions

        # Get words that user hasn't studied yet (new words)
        new_where_parts = ["uw.user_id=?", "uw.status='new'", "uw.next_review<=?"]
        new_params = [session["user_id"], today]
        if category:
            new_where_parts.append("w.category=?")
            new_params.append(category)
        new_where = " AND ".join(new_where_parts)

        new_words = db.execute(
            f"SELECT w.*, uw.ease_factor, uw.interval, uw.repetitions, uw.status, "
            f"uw.correct_count, uw.wrong_count FROM words w "
            f"JOIN user_words uw ON w.id=uw.word_id "
            f"WHERE {new_where} ORDER BY RANDOM() LIMIT ?",
            new_params + [new_limit]
        ).fetchall()

        result.extend([dict(r) for r in new_words])

        # If still not enough, add words from the category that user hasn't seen
        if len(result) < limit:
            still_need = limit - len(result)
            current_ids = [r["id"] for r in result]
            if current_ids:
                id_ph = ",".join("?" * len(current_ids))
                extra_words = db.execute(
                    f"SELECT w.* FROM words w "
                    f"WHERE w.category=? AND w.id NOT IN (SELECT word_id FROM user_words WHERE user_id=?) "
                    f"AND w.id NOT IN ({id_ph}) "
                    f"ORDER BY RANDOM() LIMIT ?",
                    [category if category else "cet4", session["user_id"]] + current_ids + [still_need]
                ).fetchall()
            else:
                extra_words = db.execute(
                    f"SELECT w.* FROM words w "
                    f"WHERE w.category=? AND w.id NOT IN (SELECT word_id FROM user_words WHERE user_id=?) "
                    f"ORDER BY RANDOM() LIMIT ?",
                    [category if category else "cet4", session["user_id"], still_need]
                ).fetchall()

            if extra_words:
                word_ids = [w["id"] for w in extra_words]
                get_or_create_user_words(session["user_id"], word_ids)
                extra_with_uw = db.execute(
                    f"SELECT w.*, uw.ease_factor, uw.interval, uw.repetitions, uw.status, "
                    f"uw.correct_count, uw.wrong_count FROM words w "
                    f"JOIN user_words uw ON w.id=uw.word_id AND uw.user_id=? "
                    f"WHERE w.id IN ({','.join('?'*len(word_ids))})",
                    [session["user_id"]] + word_ids
                ).fetchall()
                result.extend([dict(r) for r in extra_with_uw])

    return jsonify({"words": result, "mode": mode})


@app.route("/api/study/submit", methods=["POST"])
@login_required
def study_submit():
    """Submit a review result for a word."""
    data = request.get_json()
    word_id = data.get("word_id")
    quality = data.get("quality", 0)  # 0=wrong, 1=hard, 2=good, 3=easy

    if not word_id:
        return jsonify({"error": "缺少 word_id"}), 400

    db = get_db()
    uw = db.execute(
        "SELECT * FROM user_words WHERE user_id=? AND word_id=?",
        (session["user_id"], word_id)
    ).fetchone()

    if not uw:
        get_or_create_user_words(session["user_id"], [word_id])
        uw = db.execute(
            "SELECT * FROM user_words WHERE user_id=? AND word_id=?",
            (session["user_id"], word_id)
        ).fetchone()

    ef, interval, reps, next_review = sm2_update(
        uw["ease_factor"], uw["interval"], uw["repetitions"], quality
    )

    correct = 1 if quality >= 2 else 0
    wrong = 0 if quality >= 2 else 1

    # Determine status
    if reps >= 6 and ef >= 2.5:
        status = "mastered"
    elif reps >= 1:
        status = "learning"
    else:
        status = "learning" if quality > 0 else "new"

    db.execute(
        """UPDATE user_words SET
           ease_factor=?, interval=?, repetitions=?, next_review=?,
           last_review=?, correct_count=correct_count+?, wrong_count=wrong_count+?,
           status=?
           WHERE user_id=? AND word_id=?""",
        (ef, interval, reps, next_review, date.today().isoformat(),
         correct, wrong, status, session["user_id"], word_id)
    )
    db.commit()

    # Update daily stats
    today = date.today().isoformat()
    ds = db.execute(
        "SELECT * FROM daily_stats WHERE user_id=? AND date=?",
        (session["user_id"], today)
    ).fetchone()
    if ds:
        db.execute(
            "UPDATE daily_stats SET words_reviewed=words_reviewed+1 WHERE id=?",
            (ds["id"],)
        )
    else:
        db.execute(
            "INSERT INTO daily_stats (user_id, date, words_reviewed) VALUES (?,?,1)",
            (session["user_id"], today)
        )
    db.commit()

    # Check achievements
    check_achievements()

    return jsonify({
        "ok": True,
        "next_review": next_review,
        "interval": interval,
        "status": status
    })


@app.route("/api/study/session/start", methods=["POST"])
@login_required
def start_session():
    data = request.get_json()
    mode = data.get("mode", "flashcard")
    category = data.get("category", "all")
    db = get_db()
    cursor = db.execute(
        "INSERT INTO study_sessions (user_id, mode, category) VALUES (?,?,?)",
        (session["user_id"], mode, category)
    )
    db.commit()
    return jsonify({"session_id": cursor.lastrowid})


@app.route("/api/study/session/end", methods=["POST"])
@login_required
def end_session():
    data = request.get_json()
    session_id = data.get("session_id")
    words_count = data.get("words_count", 0)
    correct_count = data.get("correct_count", 0)
    wrong_count = data.get("wrong_count", 0)
    duration = data.get("duration_sec", 0)

    db = get_db()
    db.execute(
        """UPDATE study_sessions SET
           words_count=?, correct_count=?, wrong_count=?, duration_sec=?
           WHERE id=? AND user_id=?""",
        (words_count, correct_count, wrong_count, duration, session_id, session["user_id"])
    )

    # Update daily stats with time
    today = date.today().isoformat()
    db.execute(
        """INSERT INTO daily_stats (user_id, date, words_learned, time_spent_sec)
           VALUES (?,?,?,?)
           ON CONFLICT(user_id, date) DO UPDATE SET
           words_learned=words_learned+?, time_spent_sec=time_spent_sec+?""",
        (session["user_id"], today, words_count, duration, words_count, duration)
    )
    db.commit()
    return jsonify({"ok": True})


# --- Stats ---
@app.route("/api/stats/overview")
@login_required
def stats_overview():
    db = get_db()
    user_id = session["user_id"]

    total = db.execute(
        "SELECT COUNT(*) as c FROM user_words WHERE user_id=?", (user_id,)
    ).fetchone()["c"]
    mastered = db.execute(
        "SELECT COUNT(*) as c FROM user_words WHERE user_id=? AND status='mastered'",
        (user_id,)
    ).fetchone()["c"]
    learning = db.execute(
        "SELECT COUNT(*) as c FROM user_words WHERE user_id=? AND status='learning'",
        (user_id,)
    ).fetchone()["c"]
    total_correct = db.execute(
        "SELECT COALESCE(SUM(correct_count),0) as c FROM user_words WHERE user_id=?",
        (user_id,)
    ).fetchone()["c"]
    total_wrong = db.execute(
        "SELECT COALESCE(SUM(wrong_count),0) as c FROM user_words WHERE user_id=?",
        (user_id,)
    ).fetchone()["c"]
    total_reviews = total_correct + total_wrong
    accuracy = round(total_correct / total_reviews * 100, 1) if total_reviews > 0 else 0

    # Weekly stats
    week_data = []
    for i in range(6, -1, -1):
        d = (date.today() - timedelta(days=i)).isoformat()
        stat = db.execute(
            "SELECT * FROM daily_stats WHERE user_id=? AND date=?",
            (user_id, d)
        ).fetchone()
        week_data.append({
            "date": d,
            "words_learned": stat["words_learned"] if stat else 0,
            "words_reviewed": stat["words_reviewed"] if stat else 0,
            "time_spent_sec": stat["time_spent_sec"] if stat else 0
        })

    # Category breakdown
    cat_stats = db.execute(
        """SELECT w.category, COUNT(*) as total,
           SUM(CASE WHEN uw.status='mastered' THEN 1 ELSE 0 END) as mastered,
           SUM(CASE WHEN uw.status='learning' THEN 1 ELSE 0 END) as learning,
           SUM(CASE WHEN uw.status='new' THEN 1 ELSE 0 END) as new_count,
           ROUND(AVG(uw.ease_factor), 2) as avg_ef
           FROM user_words uw JOIN words w ON uw.word_id=w.id
           WHERE uw.user_id=? GROUP BY w.category""",
        (user_id,)
    ).fetchall()

    # Monthly heatmap data (last 90 days)
    heatmap = []
    for i in range(89, -1, -1):
        d = (date.today() - timedelta(days=i)).isoformat()
        stat = db.execute(
            "SELECT words_learned, words_reviewed FROM daily_stats WHERE user_id=? AND date=?",
            (user_id, d)
        ).fetchone()
        if stat and (stat["words_learned"] > 0 or stat["words_reviewed"] > 0):
            heatmap.append({
                "date": d,
                "count": stat["words_learned"] + stat["words_reviewed"]
            })
        else:
            heatmap.append({"date": d, "count": 0})

    return jsonify({
        "total": total,
        "mastered": mastered,
        "learning": learning,
        "accuracy": accuracy,
        "total_reviews": total_reviews,
        "week_data": week_data,
        "category_stats": [dict(r) for r in cat_stats],
        "heatmap": heatmap
    })


@app.route("/api/stats/achievements")
@login_required
def get_achievements():
    db = get_db()
    unlocked = db.execute(
        "SELECT achievement_key FROM achievements WHERE user_id=?",
        (session["user_id"],)
    ).fetchall()
    unlocked_keys = {r["achievement_key"] for r in unlocked}

    # Define all achievements
    all_achievements = [
        {"key": "first_word", "name": "初学者", "desc": "学习第一个单词", "icon": "🌱"},
        {"key": "ten_words", "name": "迈出第一步", "desc": "学习 10 个单词", "icon": "👣"},
        {"key": "hundred_words", "name": "百词斩", "desc": "掌握 100 个单词", "icon": "⚔️"},
        {"key": "five_hundred", "name": "学霸", "desc": "掌握 500 个单词", "icon": "📚"},
        {"key": "thousand", "name": "千词王", "desc": "掌握 1000 个单词", "icon": "👑"},
        {"key": "streak_3", "name": "三天打鱼", "desc": "连续学习 3 天", "icon": "🔥"},
        {"key": "streak_7", "name": "周不懈", "desc": "连续学习 7 天", "icon": "💪"},
        {"key": "streak_30", "name": "月桂冠", "desc": "连续学习 30 天", "icon": "🏆"},
        {"key": "perfect_10", "name": "完美十连", "desc": "单次学习连续答对 10 题", "icon": "⭐"},
        {"key": "accuracy_90", "name": "精确打击", "desc": "总正确率超过 90%", "icon": "🎯"},
    ]

    return jsonify({
        "achievements": [
            {**a, "unlocked": a["key"] in unlocked_keys,
             "unlocked_at": next(
                 (r["unlocked_at"] for r in unlocked if r["achievement_key"] == a["key"]),
                 None
             ) if a["key"] in unlocked_keys else None}
            for a in all_achievements
        ]
    })


def check_achievements():
    """Check and unlock achievements for current user."""
    db = get_db()
    user_id = session["user_id"]

    stats = {}
    stats["total"] = db.execute(
        "SELECT COUNT(*) as c FROM user_words WHERE user_id=?", (user_id,)
    ).fetchone()["c"]
    stats["mastered"] = db.execute(
        "SELECT COUNT(*) as c FROM user_words WHERE user_id=? AND status='mastered'",
        (user_id,)
    ).fetchone()["c"]
    stats["total_reviews"] = db.execute(
        "SELECT COALESCE(SUM(correct_count+wrong_count),0) as c FROM user_words WHERE user_id=?",
        (user_id,)
    ).fetchone()["c"]

    thresholds = {
        "first_word": 1,
        "ten_words": 10,
        "hundred_words": 100,
        "five_hundred": 500,
        "thousand": 1000,
    }

    for key, threshold in thresholds.items():
        if stats["mastered"] >= threshold:
            try:
                db.execute(
                    "INSERT OR IGNORE INTO achievements (user_id, achievement_key) VALUES (?,?)",
                    (user_id, key)
                )
            except:
                pass
    db.commit()


# --- Settings ---
@app.route("/api/settings", methods=["GET", "PUT"])
@login_required
def settings():
    db = get_db()
    if request.method == "GET":
        s = db.execute(
            "SELECT * FROM user_settings WHERE user_id=?",
            (session["user_id"],)
        ).fetchone()
        return jsonify(dict(s) if s else {})

    data = request.get_json()
    allowed = ["daily_goal", "theme", "reminder_enabled", "reminder_time"]
    updates = {k: data[k] for k in allowed if k in data}
    if updates:
        sets = ", ".join(f"{k}=?" for k in updates)
        vals = list(updates.values())
        db.execute(
            f"UPDATE user_settings SET {sets} WHERE user_id=?",
            vals + [session["user_id"]]
        )
        db.commit()
    return jsonify({"ok": True})


# --- Favorites ---
@app.route("/api/favorites", methods=["GET"])
@login_required
def get_favorites():
    db = get_db()
    rows = db.execute(
        """SELECT w.*, uw.status, uw.correct_count, uw.wrong_count
           FROM words w JOIN user_words uw ON w.id=uw.word_id
           WHERE uw.user_id=? AND uw.is_favorite=1""",
        (session["user_id"],)
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/favorites/<int:word_id>", methods=["POST"])
@login_required
def toggle_favorite(word_id):
    db = get_db()
    uw = db.execute(
        "SELECT is_favorite FROM user_words WHERE user_id=? AND word_id=?",
        (session["user_id"], word_id)
    ).fetchone()
    if uw:
        new_val = 0 if uw["is_favorite"] else 1
        db.execute(
            "UPDATE user_words SET is_favorite=? WHERE user_id=? AND word_id=?",
            (new_val, session["user_id"], word_id)
        )
    else:
        db.execute(
            "INSERT INTO user_words (user_id, word_id, is_favorite) VALUES (?,?,1)",
            (session["user_id"], word_id)
        )
    db.commit()
    return jsonify({"ok": True, "is_favorite": 0 if uw and uw["is_favorite"] else 1})


# --- Wrong words / Error book ---
@app.route("/api/wrong-words")
@login_required
def get_wrong_words():
    db = get_db()
    rows = db.execute(
        """SELECT w.*, uw.wrong_count, uw.correct_count, uw.status
           FROM words w JOIN user_words uw ON w.id=uw.word_id
           WHERE uw.user_id=? AND uw.wrong_count > 0
           ORDER BY uw.wrong_count DESC LIMIT 100""",
        (session["user_id"],)
    ).fetchall()
    return jsonify([dict(r) for r in rows])


# --- Serve SPA ---
@app.route("/")
def index():
    return send_from_directory("templates", "index.html")


@app.route("/manifest.json")
def manifest():
    return send_from_directory("static", "manifest.json")


@app.route("/sw.js")
def service_worker():
    return send_from_directory("static", "sw.js")


if __name__ == "__main__":
    init_db()

    # Load word lists into DB if needed
    db = sqlite3.connect(DATABASE)
    word_count = db.execute("SELECT COUNT(*) as c FROM words").fetchone()[0]
    db.close()
    if word_count == 0:
        print("Loading word lists into database...")
        db = sqlite3.connect(DATABASE)
        for cat in ["cet4", "cet6", "kaoyan"]:
            path = f"data/words/{cat}.json"
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    wlist = json.load(f)
                c = 0
                for w in wlist:
                    english = w["english"].strip().lower()
                    chinese = w.get("chinese", "")
                    phonetic = w.get("phonetic", "")
                    existing = db.execute(
                        "SELECT id FROM words WHERE english=? AND category=?",
                        (english, cat)
                    ).fetchone()
                    if not existing:
                        db.execute(
                            "INSERT INTO words (english, chinese, phonetic, category) VALUES (?,?,?,?)",
                            (english, chinese, phonetic, cat)
                        )
                        c += 1
                db.commit()
                print(f"  {cat}: loaded {c} words")
        db.close()
        print("Done loading words!")

    print("Starting 邪王真翔的背单词小工具 on http://localhost:8520")
    app.run(host="0.0.0.0", port=8520, debug=True)
