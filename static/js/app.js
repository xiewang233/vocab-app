/* ================================================================
   邪王真翔的背单词小工具 — Offline-First PWA
   All data stored in IndexedDB. No server required.
   ================================================================ */

// ==================== IndexedDB Layer ====================
const DB_NAME = 'vocab_app';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('words')) {
        db.createObjectStore('words', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('userWords')) {
        const uw = db.createObjectStore('userWords', { keyPath: 'id', autoIncrement: true });
        uw.createIndex('nextReview', 'nextReview', { unique: false });
        uw.createIndex('wordId', 'wordId', { unique: false });
        uw.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains('studySessions')) {
        db.createObjectStore('studySessions', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('dailyStats')) {
        const ds = db.createObjectStore('dailyStats', { keyPath: 'id', autoIncrement: true });
        ds.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('achievements')) {
        db.createObjectStore('achievements', { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function dbPut(storeName, data) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = 'key' in data ? store.put(data) : store.add(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

function dbGetAll(storeName) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

function dbGet(storeName, id) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

function dbDelete(storeName, id) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
}

function dbClear(storeName) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
}

// ==================== App State ====================
const App = {
  currentPage: 'home',
  studyMode: 'flashcard',
  studyCategory: '',
  studyWords: [],
  studyIndex: 0,
  studyCorrect: 0,
  studyWrong: 0,
  sessionStartTime: 0,
  consecutiveCorrect: 0,
  wordDataLoaded: false
};

// ==================== Init ====================
async function initApp() {
  try {
    // Check if words are loaded
    const words = await dbGetAll('words');
    if (words.length === 0) {
      await loadWordData();
    } else {
      App.wordDataLoaded = true;
    }

    // Check username (local pseudo-auth)
    const settings = await dbGetAll('settings');
    const username = settings.find(s => s.key === 'username');
    if (username) {
      showMainApp(username.value);
    } else {
      showWelcome();
    }
  } catch (e) {
    console.error('Init error:', e);
    showWelcome();
  }
}

// ==================== Word Data Loading ====================
async function loadWordData() {
  const statusEl = document.getElementById('loading-status');
  const progressEl = document.getElementById('loading-progress');

  const categories = [
    { file: 'data/words/cet4.json', name: 'cet4', label: '四级词库' },
    { file: 'data/words/cet6.json', name: 'cet6', label: '六级词库' },
    { file: 'data/words/kaoyan.json', name: 'kaoyan', label: '考研词库' },
  ];

  let totalLoaded = 0;
  for (const cat of categories) {
    statusEl.textContent = `正在加载${cat.label}...`;
    progressEl.style.width = `${(categories.indexOf(cat) / categories.length) * 100}%`;
    try {
      const resp = await fetch(cat.file);
      const data = await resp.json();
      const db = await openDB();
      const tx = db.transaction('words', 'readwrite');
      const store = tx.objectStore('words');
      for (const w of data) {
        store.add({
          english: w.english,
          chinese: w.chinese,
          phonetic: w.phonetic || '',
          category: w.category
        });
      }
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = reject;
      });
      totalLoaded += data.length;
    } catch (e) {
      console.warn(`Failed to load ${cat.label}:`, e);
    }
  }

  progressEl.style.width = '100%';
  statusEl.textContent = `词库加载完成！共 ${totalLoaded} 词`;
  App.wordDataLoaded = true;

  // Save loading flag
  await dbPut('settings', { key: 'wordsLoaded', value: 'true' });

  setTimeout(() => {
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
  }, 600);
}

// ==================== Auth (Local) ====================
function showWelcome() {
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('welcome-page').classList.add('active');
}

function showMainApp(username) {
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('welcome-page').classList.remove('active');
  document.getElementById('main-page').classList.add('active');
  App.username = username;
  document.getElementById('header-username').textContent = username;
  navigateTo('home');
}

async function handleRegister() {
  const name = document.getElementById('reg-name').value.trim();
  if (!name || name.length < 2) {
    showError('reg-error', '昵称至少 2 个字符');
    return;
  }
  await dbPut('settings', { key: 'username', value: name });
  await dbPut('settings', { key: 'dailyGoal', value: '20' });
  await dbPut('settings', { key: 'theme', value: 'dark' });
  showMainApp(name);
}

function showError(id, msg) {
  document.getElementById(id).textContent = msg;
  setTimeout(() => { document.getElementById(id).textContent = ''; }, 3000);
}

// ==================== Navigation ====================
function navigateTo(page, data) {
  App.currentPage = page;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const btn = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (btn) btn.classList.add('active');

  const main = document.getElementById('main-content');
  switch (page) {
    case 'home': renderHome(main); break;
    case 'study': renderStudySetup(main); break;
    case 'stats': renderStats(main); break;
    case 'profile': renderProfile(main, data); break;
    case 'flashcard': startFlashcard(main, data); break;
    case 'choice': startChoice(main, data); break;
    case 'spelling': startSpelling(main, data); break;
    case 'speed': startSpeedReview(main, data); break;
    case 'listen': startListenMode(main, data); break;
    default: renderHome(main);
  }
}

document.querySelector('.bottom-nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (btn) navigateTo(btn.dataset.page);
});

// ==================== Home Dashboard ====================
async function renderHome(container) {
  const stats = await getStudyStats();
  const dueToday = await getDueTodayCount();
  const streak = await getStreak();
  const settings = await getSettings();
  const dailyGoal = parseInt(settings.dailyGoal || '20');

  document.getElementById('header-streak').textContent = `🔥 ${streak}天`;

  const achieveData = await getAchievements();
  const unlockedCount = achieveData.filter(a => a.unlocked).length;

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card accent">
        <div class="stat-value">${dueToday}</div>
        <div class="stat-label">今日待复习</div>
      </div>
      <div class="stat-card success">
        <div class="stat-value">${stats.mastered}</div>
        <div class="stat-label">已掌握</div>
      </div>
      <div class="stat-card warning">
        <div class="stat-value">${streak}天</div>
        <div class="stat-label">连续打卡</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.total}</div>
        <div class="stat-label">学习单词</div>
      </div>
    </div>

    <div class="mt-16">
      <div class="card-title mb-8">快速开始</div>
      <div class="quick-actions">
        <div class="quick-action" onclick="navigateTo('study')">
          <span class="action-icon">📝</span><span class="action-label">背单词</span>
        </div>
        <div class="quick-action" onclick="navigateTo('stats')">
          <span class="action-icon">📊</span><span class="action-label">学习报告</span>
        </div>
        <div class="quick-action" onclick="navigateTo('profile', {tab:'wrong'})">
          <span class="action-icon">📕</span><span class="action-label">错题本</span>
        </div>
        <div class="quick-action" onclick="navigateTo('profile', {tab:'fav'})">
          <span class="action-icon">⭐</span><span class="action-label">收藏夹</span>
        </div>
      </div>
    </div>

    <div class="card mt-12">
      <div class="flex-between">
        <span class="card-title">📅 每日目标</span>
        <span class="text-dim" style="font-size:13px">${Math.min(stats.todayReviewed || 0, dailyGoal)} / ${dailyGoal} 词</span>
      </div>
      <div class="progress-bar mt-8">
        <div class="progress-fill" style="width:${Math.min(100, ((stats.todayReviewed || 0) / dailyGoal) * 100)}%"></div>
      </div>
    </div>

    <div class="card mt-12">
      <div class="card-header">
        <span class="card-title">🏆 成就徽章</span>
        <span class="text-dim" style="font-size:12px">${unlockedCount}/${achieveData.length}</span>
      </div>
      <div class="achievement-grid">
        ${achieveData.slice(0, 6).map(a => `
          <div class="achievement-item ${a.unlocked ? 'unlocked' : ''}">
            <span class="achievement-icon">${a.unlocked ? a.icon : '🔒'}</span>
            <div class="achievement-info">
              <div class="achievement-name">${a.unlocked ? a.name : '???'}</div>
              <div class="achievement-desc">${a.unlocked ? a.desc : '尚未解锁'}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

async function getStudyStats() {
  const uws = await dbGetAll('userWords');
  const today = new Date().toISOString().slice(0, 10);
  const dsAll = await dbGetAll('dailyStats');
  const todayStats = dsAll.filter(d => d.date === today);

  return {
    total: uws.length,
    mastered: uws.filter(u => u.status === 'mastered').length,
    learning: uws.filter(u => u.status === 'learning').length,
    todayReviewed: todayStats.reduce((s, d) => s + (d.wordsReviewed || 0), 0)
  };
}

async function getDueTodayCount() {
  const today = new Date().toISOString().slice(0, 10);
  const uws = await dbGetAll('userWords');
  return uws.filter(u => !u.nextReview || u.nextReview <= today).length;
}

async function getStreak() {
  const dsAll = await dbGetAll('dailyStats');
  const dates = [...new Set(dsAll.map(d => d.date))].sort().reverse();
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < dates.length; i++) {
    const expected = new Date(today);
    expected.setDate(expected.getDate() - i);
    const expectedStr = expected.toISOString().slice(0, 10);
    if (dates[i] === expectedStr) streak++;
    else break;
  }
  return streak;
}

async function getSettings() {
  const all = await dbGetAll('settings');
  const obj = {};
  all.forEach(s => { obj[s.key] = s.value; });
  return obj;
}

// ==================== SM-2 Algorithm ====================
function sm2Update(ef, interval, reps, quality) {
  if (quality === 0) {
    ef = Math.max(1.3, ef - 0.3);
    interval = 1;
    reps = 0;
  } else if (quality === 1) {
    ef = Math.max(1.3, ef - 0.15);
    interval = Math.max(1, Math.floor(interval * 1.2));
    reps += 1;
  } else if (quality === 2) {
    ef += 0.1;
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 3;
    else interval = Math.floor(interval * ef);
    reps += 1;
  } else {
    ef += 0.15;
    if (reps === 0) interval = 3;
    else if (reps === 1) interval = 7;
    else interval = Math.floor(interval * ef * 1.3);
    reps += 1;
  }
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + interval);
  return { ef, interval, reps, nextReview: nextDate.toISOString().slice(0, 10) };
}

// ==================== Study Setup ====================
async function renderStudySetup(container) {
  App.studyMode = 'flashcard';
  const words = await dbGetAll('words');
  const categories = {};
  words.forEach(w => {
    if (!categories[w.category]) categories[w.category] = 0;
    categories[w.category]++;
  });

  container.innerHTML = `
    <h2 class="card-title mb-8">选择学习模式</h2>
    <div class="mode-selector">
      <div class="mode-card selected" data-mode="flashcard" onclick="selectMode('flashcard', this)">
        <div class="mode-icon">🃏</div>
        <div class="mode-name">闪卡模式</div>
        <div class="mode-desc">翻转卡片，自评掌握度</div>
      </div>
      <div class="mode-card" data-mode="choice" onclick="selectMode('choice', this)">
        <div class="mode-icon">🎯</div>
        <div class="mode-name">选择题模式</div>
        <div class="mode-desc">四选一，即时反馈</div>
      </div>
      <div class="mode-card" data-mode="spelling" onclick="selectMode('spelling', this)">
        <div class="mode-icon">✍️</div>
        <div class="mode-name">拼写模式</div>
        <div class="mode-desc">看中文写英文</div>
      </div>
      <div class="mode-card" data-mode="speed" onclick="selectMode('speed', this)">
        <div class="mode-icon">⚡</div>
        <div class="mode-name">速览模式</div>
        <div class="mode-desc">快速浏览，碎片学习</div>
      </div>
    </div>

    <h3 class="card-title mb-8 mt-16">选择词库</h3>
    <div class="category-select">
      <div class="category-chip selected" data-cat="" onclick="selectCategory('', this)">全部</div>
      ${Object.entries(categories).map(([cat, count]) => `
        <div class="category-chip" data-cat="${cat}" onclick="selectCategory('${cat}', this)">
          ${categoryName(cat)} <span class="chip-count">${count}</span>
        </div>
      `).join('')}
      <div class="category-chip" data-cat="custom" onclick="selectCategory('custom', this)">自定义</div>
    </div>

    <button class="btn-primary mt-20" style="width:100%" onclick="startStudy()">
      开始学习 🚀
    </button>
  `;
}

function selectMode(mode, el) {
  App.studyMode = mode;
  document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
}

function selectCategory(cat, el) {
  App.studyCategory = cat;
  document.querySelectorAll('.category-chip').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
}

function categoryName(cat) {
  const map = { cet4: '四级', cet6: '六级', kaoyan: '考研', custom: '自定义' };
  return map[cat] || cat;
}

async function startStudy() {
  navigateTo(App.studyMode, { category: App.studyCategory });
}

// ==================== Flashcard Mode ====================
async function startFlashcard(container, opts) {
  container.innerHTML = '<div class="text-center mt-20 text-dim">准备单词中...</div>';
  const words = await getStudyWords(opts.category || '', 20);
  App.studyWords = words;
  App.studyIndex = 0;
  App.studyCorrect = 0;
  App.studyWrong = 0;
  App.consecutiveCorrect = 0;
  App.sessionStartTime = Date.now();

  if (!words.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🎉</div><p>太棒了！当前词库没有待复习单词</p><button class="btn-primary mt-12" onclick="navigateTo(\'study\')">选择其他词库</button></div>';
    return;
  }
  showFlashcardWord(container);
}

async function getStudyWords(category, limit) {
  const today = new Date().toISOString().slice(0, 10);
  const allUws = await dbGetAll('userWords');
  const allWords = await dbGetAll('words');

  // Map wordId -> userWord
  const uwMap = {};
  allUws.forEach(u => { uwMap[u.wordId] = u; });

  let candidates = [];

  // First: due review words
  for (const w of allWords) {
    if (category && w.category !== category) continue;
    const uw = uwMap[w.id];
    if (uw && uw.nextReview && uw.nextReview <= today) {
      candidates.push({ ...w, ...uw, priority: 1 });
    }
  }

  // Second: new words (not studied yet)
  for (const w of allWords) {
    if (category && w.category !== category) continue;
    const uw = uwMap[w.id];
    if (!uw) {
      candidates.push({
        ...w,
        ease_factor: 2.5,
        interval: 0,
        repetitions: 0,
        nextReview: today,
        correct_count: 0,
        wrong_count: 0,
        status: 'new',
        priority: 2
      });
    }
  }

  // Sort: review first, then new
  candidates.sort((a, b) => a.priority - b.priority);

  // Take limit + shuffle within priority groups
  const result = candidates.slice(0, limit * 2);
  // Fisher-Yates shuffle
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result.slice(0, limit);
}

function showFlashcardWord(container) {
  if (App.studyIndex >= App.studyWords.length) {
    endStudy(container, 'flashcard');
    return;
  }
  const w = App.studyWords[App.studyIndex];
  const progress = (App.studyIndex / App.studyWords.length * 100).toFixed(0);

  container.innerHTML = `
    <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
    <div class="progress-text">${App.studyIndex + 1} / ${App.studyWords.length}</div>
    <div class="flashcard-container">
      <div class="flashcard" id="flashcard" onclick="flipCard()" style="position:relative;min-height:280px;cursor:pointer">
        <div class="flashcard-face" style="position:absolute;width:100%;min-height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <div class="flashcard-word">${w.english}</div>
          <div class="flashcard-phonetic">/${w.phonetic || ''}/</div>
          <button class="btn-sm mt-12" onclick="event.stopPropagation();speakWord('${w.english}')">🔊 发音</button>
          <div class="flashcard-hint">👆 点击翻转查看释义</div>
        </div>
        <div class="flashcard-face flashcard-back" style="position:absolute;width:100%;min-height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <div class="flashcard-word" style="font-size:22px">${w.english}</div>
          <div class="flashcard-phonetic">/${w.phonetic || ''}/</div>
          <div class="flashcard-definition">${w.chinese}</div>
          <div class="flashcard-status">复习 ${w.repetitions || 0} 次 | 正确 ${w.correct_count || 0}</div>
        </div>
      </div>
    </div>
    <div class="quality-buttons" id="quality-btns" style="display:none">
      <button class="quality-btn wrong" onclick="handleFlashcardAnswer(0)">😰 不认识</button>
      <button class="quality-btn hard" onclick="handleFlashcardAnswer(1)">🤔 模糊</button>
      <button class="quality-btn good" onclick="handleFlashcardAnswer(2)">😊 认识</button>
      <button class="quality-btn easy" onclick="handleFlashcardAnswer(3)">🤩 简单</button>
    </div>
    <div class="text-center mt-8">
      <button class="btn-sm" style="background:transparent;border:1px solid rgba(255,255,255,0.2);" onclick="event.stopPropagation();toggleFavorite(${w.id})">⭐ 收藏</button>
    </div>
  `;
}

function flipCard() {
  const card = document.getElementById('flashcard');
  if (card) {
    card.classList.toggle('flipped');
    const btns = document.getElementById('quality-btns');
    if (btns) btns.style.display = card.classList.contains('flipped') ? 'flex' : 'none';
  }
}

async function answerQuality(quality) {
  const w = App.studyWords[App.studyIndex];
  const existing = (await dbGetAll('userWords')).find(u => u.wordId === w.id);

  const ef = existing ? existing.ease_factor : 2.5;
  const interval = existing ? existing.interval : 0;
  const reps = existing ? existing.repetitions : 0;

  const result = sm2Update(ef, interval, reps, quality);

  const status = result.reps >= 6 && result.ef >= 2.5 ? 'mastered'
    : result.reps >= 1 ? 'learning' : 'new';

  const userWord = {
    wordId: w.id,
    ease_factor: result.ef,
    interval: result.interval,
    repetitions: result.reps,
    nextReview: result.nextReview,
    lastReview: new Date().toISOString().slice(0, 10),
    correct_count: (existing ? existing.correct_count : 0) + (quality >= 2 ? 1 : 0),
    wrong_count: (existing ? existing.wrong_count : 0) + (quality < 2 ? 1 : 0),
    status,
    is_favorite: existing ? existing.is_favorite : 0
  };

  if (existing) {
    userWord.id = existing.id;
  }
  await dbPut('userWords', userWord);

  if (quality >= 2) { App.studyCorrect++; App.consecutiveCorrect++; }
  else { App.studyWrong++; App.consecutiveCorrect = 0; }

  // Update daily stats
  await updateDailyStats(1);

  // Check achievements
  await checkAchievements();

  App.studyIndex++;
}

async function handleFlashcardAnswer(quality) {
  await answerQuality(quality);
  showFlashcardWord(document.getElementById('main-content'));
}

async function updateDailyStats(reviewed) {
  const today = new Date().toISOString().slice(0, 10);
  const all = await dbGetAll('dailyStats');
  const existing = all.find(d => d.date === today);
  if (existing) {
    existing.wordsReviewed = (existing.wordsReviewed || 0) + reviewed;
    await dbPut('dailyStats', existing);
  } else {
    await dbPut('dailyStats', { date: today, wordsReviewed: reviewed, wordsLearned: 0, timeSpentSec: 0 });
  }
}

async function toggleFavorite(wordId) {
  const all = await dbGetAll('userWords');
  const existing = all.find(u => u.wordId === wordId);
  if (existing) {
    existing.is_favorite = existing.is_favorite ? 0 : 1;
    await dbPut('userWords', existing);
  } else {
    await dbPut('userWords', { wordId, is_favorite: 1, ease_factor: 2.5, interval: 0, repetitions: 0, nextReview: new Date().toISOString().slice(0, 10), correct_count: 0, wrong_count: 0, status: 'new' });
  }
  showToast('已切换收藏');
}

function speakWord(word) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US'; u.rate = 0.85;
    window.speechSynthesis.speak(u);
  }
}

async function endStudy(container, mode) {
  const duration = Math.floor((Date.now() - App.sessionStartTime) / 1000);

  // Update daily stats with session info
  const today = new Date().toISOString().slice(0, 10);
  const all = await dbGetAll('dailyStats');
  const existing = all.find(d => d.date === today);
  if (existing) {
    existing.wordsLearned = (existing.wordsLearned || 0) + App.studyWords.length;
    existing.timeSpentSec = (existing.timeSpentSec || 0) + duration;
    await dbPut('dailyStats', existing);
  }

  // Save session
  await dbPut('studySessions', {
    mode, category: App.studyCategory || 'all',
    wordsCount: App.studyWords.length,
    correctCount: App.studyCorrect,
    wrongCount: App.studyWrong,
    durationSec: duration,
    createdAt: new Date().toISOString()
  });

  const acc = App.studyWords.length > 0
    ? Math.round(App.studyCorrect / App.studyWords.length * 100) : 0;

  if (App.consecutiveCorrect >= 10) {
    showToast('🏆 解锁成就：完美十连！');
  }

  container.innerHTML = `
    <div class="text-center" style="padding:40px 20px">
      <div style="font-size:64px;margin-bottom:16px">${acc >= 80 ? '🎉' : acc >= 50 ? '👍' : '💪'}</div>
      <h2>学习完成！</h2>
      <div class="stats-grid mt-16">
        <div class="stat-card"><div class="stat-value">${App.studyWords.length}</div><div class="stat-label">学习单词</div></div>
        <div class="stat-card success"><div class="stat-value">${App.studyCorrect}</div><div class="stat-label">正确</div></div>
        <div class="stat-card danger"><div class="stat-value">${App.studyWrong}</div><div class="stat-label">需要复习</div></div>
        <div class="stat-card accent"><div class="stat-value">${acc}%</div><div class="stat-label">正确率</div></div>
      </div>
      <p class="text-dim mt-12">用时 ${formatDuration(duration)}</p>
      <div class="flex-center gap-8 mt-16">
        <button class="btn-primary" onclick="navigateTo('study')">继续学习</button>
        <button class="btn-sm" style="background:transparent;border:1px solid rgba(255,255,255,0.2)" onclick="navigateTo('home')">返回首页</button>
      </div>
    </div>
  `;
}

// ==================== Choice Mode ====================
async function startChoice(container, opts) {
  container.innerHTML = '<div class="text-center mt-20 text-dim">准备单词中...</div>';
  const words = await getStudyWords(opts.category || '', 20);
  App.studyWords = words;
  App.studyIndex = 0;
  App.studyCorrect = 0;
  App.studyWrong = 0;
  App.consecutiveCorrect = 0;
  App.sessionStartTime = Date.now();

  if (!words.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🎉</div><p>没有待复习单词</p><button class="btn-primary mt-12" onclick="navigateTo(\'study\')">选择其他词库</button></div>';
    return;
  }
  showChoiceWord(container);
}

function showChoiceWord(container) {
  if (App.studyIndex >= App.studyWords.length) {
    endStudy(container, 'choice');
    return;
  }
  const w = App.studyWords[App.studyIndex];
  const progress = (App.studyIndex / App.studyWords.length * 100).toFixed(0);

  // Get distractors from same batch
  const distractors = App.studyWords
    .filter(x => x.id !== w.id)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);

  const options = [w, ...distractors].sort(() => Math.random() - 0.5);

  container.innerHTML = `
    <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
    <div class="progress-text">${App.studyIndex + 1} / ${App.studyWords.length}</div>
    <div class="choice-container">
      <button class="btn-sm mt-8" onclick="speakWord('${w.english}')" style="display:block;margin:0 auto">🔊 发音</button>
      <div class="choice-word">${w.english}</div>
      <div class="choice-phonetic">/${w.phonetic || ''}/</div>
      <div class="choice-options">
        ${options.map((o, i) => `
          <div class="choice-option" data-correct="${o.id === w.id}" onclick="pickChoice(${o.id}, ${w.id}, this)">
            ${'ABCD'[i]}. ${(o.chinese || '').substring(0, 30)}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

async function pickChoice(pickedId, correctId, el) {
  document.querySelectorAll('.choice-option').forEach(o => o.style.pointerEvents = 'none');
  const correct = pickedId === correctId;

  if (correct) {
    el.classList.add('correct');
    App.studyCorrect++;
    App.consecutiveCorrect++;
  } else {
    el.classList.add('wrong');
    App.studyWrong++;
    App.consecutiveCorrect = 0;
    document.querySelectorAll('.choice-option').forEach(o => {
      if (o.dataset.correct === 'true') o.classList.add('correct');
    });
  }

  await answerQuality(correct ? 2 : 0);

  setTimeout(() => {
    showChoiceWord(document.getElementById('main-content'));
  }, 800);
}

// ==================== Spelling Mode ====================
async function startSpelling(container, opts) {
  container.innerHTML = '<div class="text-center mt-20 text-dim">准备单词中...</div>';
  const words = await getStudyWords(opts.category || '', 20);
  App.studyWords = words;
  App.studyIndex = 0;
  App.studyCorrect = 0;
  App.studyWrong = 0;
  App.sessionStartTime = Date.now();

  if (!words.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🎉</div><p>没有待复习单词</p><button class="btn-primary mt-12" onclick="navigateTo(\'study\')">选择其他词库</button></div>';
    return;
  }
  showSpellingWord(container);
}

function showSpellingWord(container) {
  if (App.studyIndex >= App.studyWords.length) {
    endStudy(container, 'spelling');
    return;
  }
  const w = App.studyWords[App.studyIndex];
  const progress = (App.studyIndex / App.studyWords.length * 100).toFixed(0);

  container.innerHTML = `
    <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
    <div class="progress-text">${App.studyIndex + 1} / ${App.studyWords.length}</div>
    <div class="spelling-container">
      <div class="spelling-hint">${(w.chinese || '').substring(0, 40)}</div>
      <div class="text-dim mb-8" style="font-size:13px">/${w.phonetic || ''}/</div>
      <button class="btn-sm mb-8" onclick="speakWord('${w.english}')">🔊 听发音</button>
      <input type="text" class="spelling-input" id="spell-input" placeholder="输入英文拼写..." autocomplete="off" autocapitalize="off">
      <div class="spelling-result" id="spell-result"></div>
      <button class="btn-primary mt-8" style="width:100%" onclick="checkSpelling('${w.english.replace(/'/g, "\\'")}')">确认</button>
      <button class="btn-sm mt-8" style="background:transparent;border:1px solid rgba(255,255,255,0.2);width:100%" onclick="showSpellAnswer('${w.english.replace(/'/g, "\\'")}')">显示答案</button>
    </div>
    <div id="spell-next" style="display:none">
      <button class="btn-primary mt-8" style="width:100%" onclick="nextSpelling()">下一题</button>
    </div>
  `;
  setTimeout(() => { const inp = document.getElementById('spell-input'); if (inp) inp.focus(); }, 100);
}

function checkSpelling(answer) {
  const input = document.getElementById('spell-input').value.trim().toLowerCase();
  const result = document.getElementById('spell-result');
  const nextBtn = document.getElementById('spell-next');
  if (input === answer.toLowerCase()) {
    result.innerHTML = '<span style="color:var(--success)">✅ 正确！</span>';
    App.studyCorrect++;
    answerQuality(3);
  } else {
    result.innerHTML = `<span style="color:var(--danger)">❌ 错误！正确答案：<b>${answer}</b></span>`;
    App.studyWrong++;
    answerQuality(0);
  }
  document.getElementById('spell-input').disabled = true;
  nextBtn.style.display = 'block';
}

function showSpellAnswer(answer) {
  document.getElementById('spell-result').innerHTML = `正确答案：<b>${answer}</b>`;
  document.getElementById('spell-next').style.display = 'block';
  App.studyWrong++;
  answerQuality(0);
}

function nextSpelling() {
  showSpellingWord(document.getElementById('main-content'));
}

// ==================== Speed Review ====================
async function startSpeedReview(container, opts) {
  container.innerHTML = '<div class="text-center mt-20 text-dim">加载中...</div>';
  const words = await getStudyWords(opts.category || '', 50);
  App.studyWords = words;
  App.studyIndex = 0;
  if (!words.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🎉</div><p>没有单词</p><button class="btn-primary mt-12" onclick="navigateTo(\'study\')">去学新词</button></div>';
    return;
  }
  showSpeedWord(container);
}

function showSpeedWord(container) {
  if (App.studyIndex >= App.studyWords.length) {
    container.innerHTML = `
      <div class="text-center" style="padding:40px 20px">
        <div style="font-size:64px">✅</div><h2>速览完成！</h2>
        <p class="text-dim mt-8">共浏览 ${App.studyWords.length} 个单词</p>
        <button class="btn-primary mt-16" onclick="navigateTo('study')">选择其他模式</button>
      </div>`;
    return;
  }
  const w = App.studyWords[App.studyIndex];
  const progress = (App.studyIndex / App.studyWords.length * 100).toFixed(0);

  container.innerHTML = `
    <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
    <div class="progress-text">${App.studyIndex + 1} / ${App.studyWords.length}</div>
    <div class="text-center mt-20">
      <div style="font-size:28px;font-weight:700;margin-bottom:4px">${w.english}</div>
      <div style="font-size:15px;color:var(--accent-light);margin-bottom:4px">/${w.phonetic || ''}/</div>
      <button class="btn-sm mb-8" onclick="speakWord('${w.english}')">🔊</button>
      <div style="font-size:16px;color:var(--text-dim);margin-top:8px;line-height:1.6">${w.chinese}</div>
    </div>
    <div class="flex-center gap-8 mt-20">
      <button class="btn-primary" style="flex:1" onclick="App.studyIndex++;showSpeedWord(document.getElementById('main-content'));">下一个 ⏭️</button>
    </div>
  `;
}

// ==================== Listen Mode ====================
async function startListenMode(container, opts) {
  container.innerHTML = '<div class="text-center mt-20 text-dim">加载中...</div>';
  const words = await getStudyWords(opts.category || '', 20);
  App.studyWords = words;
  App.studyIndex = 0;
  App.studyCorrect = 0;
  App.studyWrong = 0;
  App.sessionStartTime = Date.now();
  if (!words.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🎉</div><p>没有单词</p></div>';
    return;
  }
  showListenWord(container);
}

function showListenWord(container) {
  if (App.studyIndex >= App.studyWords.length) {
    endStudy(container, 'listen');
    return;
  }
  const w = App.studyWords[App.studyIndex];
  const progress = (App.studyIndex / App.studyWords.length * 100).toFixed(0);
  setTimeout(() => speakWord(w.english), 300);

  container.innerHTML = `
    <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
    <div class="progress-text">${App.studyIndex + 1} / ${App.studyWords.length}</div>
    <div class="spelling-container">
      <button class="btn-sm mt-12" style="font-size:18px;padding:12px 24px" onclick="speakWord('${w.english.replace(/'/g, "\\'")}')">🔊 再听一遍</button>
      <div class="spelling-hint mt-16">请听发音，输入单词</div>
      <input type="text" class="spelling-input mt-8" id="listen-input" placeholder="输入你听到的单词..." autocomplete="off" autocapitalize="off">
      <div class="spelling-result" id="listen-result"></div>
      <button class="btn-primary mt-8" style="width:100%" onclick="checkListen('${w.english.replace(/'/g, "\\'")}')">确认</button>
    </div>
    <div id="listen-next" style="display:none">
      <div class="text-center mt-12">
        <div style="font-size:20px;font-weight:700">${w.english}</div>
        <div style="color:var(--text-dim)">${w.chinese}</div>
      </div>
      <button class="btn-primary mt-8" style="width:100%" onclick="nextListen()">下一题</button>
    </div>
  `;
  setTimeout(() => { const inp = document.getElementById('listen-input'); if (inp) inp.focus(); }, 400);
}

function checkListen(answer) {
  const input = document.getElementById('listen-input').value.trim().toLowerCase();
  const result = document.getElementById('listen-result');
  const nextDiv = document.getElementById('listen-next');
  if (input === answer.toLowerCase()) {
    result.innerHTML = '<span style="color:var(--success)">✅ 正确！</span>';
    App.studyCorrect++;
    answerQuality(3);
  } else {
    result.innerHTML = '<span style="color:var(--danger)">❌ 拼写有误</span>';
    App.studyWrong++;
    answerQuality(0);
  }
  document.getElementById('listen-input').disabled = true;
  nextDiv.style.display = 'block';
}

function nextListen() {
  showListenWord(document.getElementById('main-content'));
}

// ==================== Stats Page ====================
async function renderStats(container) {
  container.innerHTML = '<div class="text-center mt-20 text-dim">加载统计数据...</div>';

  const stats = await getStudyStats();
  const uws = await dbGetAll('userWords');
  const totalCorrect = uws.reduce((s, u) => s + (u.correct_count || 0), 0);
  const totalWrong = uws.reduce((s, u) => s + (u.wrong_count || 0), 0);
  const totalReviews = totalCorrect + totalWrong;
  const accuracy = totalReviews > 0 ? Math.round(totalCorrect / totalReviews * 100) : 0;

  let accClass = accuracy >= 80 ? 'high' : accuracy >= 60 ? 'medium' : 'low';

  // Weekly data
  const dsAll = await dbGetAll('dailyStats');
  const weekData = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const stat = dsAll.find(s => s.date === ds);
    weekData.push({
      date: ds,
      words: (stat ? (stat.wordsLearned || 0) + (stat.wordsReviewed || 0) : 0)
    });
  }

  // Category breakdown
  const allWords = await dbGetAll('words');
  const catMap = {};
  allWords.forEach(w => {
    if (!catMap[w.category]) catMap[w.category] = { total: 0, mastered: 0 };
    catMap[w.category].total++;
  });
  uws.forEach(u => {
    const w = allWords.find(x => x.id === u.wordId);
    if (w && catMap[w.category] && u.status === 'mastered') {
      catMap[w.category].mastered++;
    }
  });

  // Heatmap (last 90 days)
  let heatmapHTML = '';
  for (let i = 89; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const stat = dsAll.find(s => s.date === ds);
    const count = stat ? (stat.wordsLearned || 0) + (stat.wordsReviewed || 0) : 0;
    let level = 0;
    if (count > 0) level = 1;
    if (count >= 5) level = 2;
    if (count >= 15) level = 3;
    if (count >= 30) level = 4;
    heatmapHTML += `<div class="heatmap-cell level-${level}" title="${ds}: ${count}词"></div>`;
  }

  const achieveData = await getAchievements();
  const unlockedCount = achieveData.filter(a => a.unlocked).length;

  const maxWeek = Math.max(...weekData.map(d => d.words), 1);

  container.innerHTML = `
    <h2 class="card-title mb-8">学习报告</h2>
    <div class="stats-grid">
      <div class="stat-card accent"><div class="stat-value">${stats.total}</div><div class="stat-label">总学习单词</div></div>
      <div class="stat-card success"><div class="stat-value">${stats.mastered}</div><div class="stat-label">已掌握</div></div>
      <div class="stat-card warning"><div class="stat-value">${stats.learning}</div><div class="stat-label">学习中</div></div>
      <div class="stat-card"><div class="stat-value"><span class="accuracy-badge ${accClass}">${accuracy}%</span></div><div class="stat-label">正确率</div></div>
    </div>

    <div class="card mt-12">
      <div class="card-title mb-8">📅 学习日历（近90天）</div>
      <div class="heatmap-grid">${heatmapHTML}</div>
      <div class="flex-between mt-8">
        <span class="text-muted" style="font-size:10px">少</span>
        <div class="flex-center gap-8">
          <span class="heatmap-cell level-0"></span><span class="heatmap-cell level-1"></span>
          <span class="heatmap-cell level-2"></span><span class="heatmap-cell level-3"></span>
          <span class="heatmap-cell level-4"></span>
        </div>
        <span class="text-muted" style="font-size:10px">多</span>
      </div>
    </div>

    <div class="card mt-12">
      <div class="card-title mb-8">📈 本周学习量</div>
      ${weekData.map(d => {
        const pct = Math.round(d.words / maxWeek * 100);
        const dayName = ['日','一','二','三','四','五','六'][new Date(d.date).getDay()];
        return `<div class="chart-bar-row">
          <span class="chart-bar-label">周${dayName}</span>
          <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${pct}%;background:var(--accent)">${d.words > 0 ? `<span class="bar-text">${d.words}</span>` : ''}</div></div>
          <span class="chart-bar-value">${d.words}词</span></div>`;
      }).join('')}
    </div>

    <div class="card mt-12">
      <div class="card-title mb-8">📊 各词库掌握度</div>
      ${Object.entries(catMap).map(([cat, c]) => {
        const pct = c.total > 0 ? Math.round(c.mastered / c.total * 100) : 0;
        return `<div class="chart-bar-row">
          <span class="chart-bar-label">${categoryName(cat)}</span>
          <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${pct}%;background:var(--success)">${pct > 10 ? `<span class="bar-text">${pct}%</span>` : ''}</div></div>
          <span class="chart-bar-value">${c.mastered}/${c.total}</span></div>`;
      }).join('')}
    </div>

    <div class="card mt-12">
      <div class="card-header">
        <span class="card-title">🏆 成就徽章</span>
        <span class="text-dim" style="font-size:12px">${unlockedCount}/${achieveData.length}</span>
      </div>
      <div class="achievement-grid">
        ${achieveData.map(a => `
          <div class="achievement-item ${a.unlocked ? 'unlocked' : ''}">
            <span class="achievement-icon">${a.unlocked ? a.icon : '🔒'}</span>
            <div class="achievement-info">
              <div class="achievement-name">${a.unlocked ? a.name : '???'}</div>
              <div class="achievement-desc">${a.unlocked ? a.desc : '尚未解锁'}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ==================== Achievements ====================
const ACHIEVEMENTS = [
  { key: 'first_word', name: '初学者', desc: '学习第一个单词', icon: '🌱' },
  { key: 'ten_words', name: '迈出第一步', desc: '学习 10 个单词', icon: '👣' },
  { key: 'hundred_words', name: '百词斩', desc: '掌握 100 个单词', icon: '⚔️' },
  { key: 'five_hundred', name: '学霸', desc: '掌握 500 个单词', icon: '📚' },
  { key: 'thousand', name: '千词王', desc: '掌握 1000 个单词', icon: '👑' },
  { key: 'streak_3', name: '三天打鱼', desc: '连续学习 3 天', icon: '🔥' },
  { key: 'streak_7', name: '周不懈', desc: '连续学习 7 天', icon: '💪' },
  { key: 'streak_30', name: '月桂冠', desc: '连续学习 30 天', icon: '🏆' },
  { key: 'accuracy_90', name: '精确打击', desc: '总正确率超过 90%', icon: '🎯' },
  { key: 'words_2000', name: '词汇大师', desc: '掌握 2000 个单词', icon: '🎓' },
];

async function getAchievements() {
  const unlocked = await dbGetAll('achievements');
  const unlockedKeys = new Set(unlocked.map(a => a.key));
  return ACHIEVEMENTS.map(a => ({
    ...a,
    unlocked: unlockedKeys.has(a.key)
  }));
}

async function checkAchievements() {
  const uws = await dbGetAll('userWords');
  const mastered = uws.filter(u => u.status === 'mastered').length;
  const streak = await getStreak();
  const totalCorrect = uws.reduce((s, u) => s + (u.correct_count || 0), 0);
  const totalWrong = uws.reduce((s, u) => s + (u.wrong_count || 0), 0);
  const accuracy = (totalCorrect + totalWrong) > 0 ? totalCorrect / (totalCorrect + totalWrong) : 0;

  const thresholds = {
    first_word: mastered >= 1,
    ten_words: mastered >= 10,
    hundred_words: mastered >= 100,
    five_hundred: mastered >= 500,
    thousand: mastered >= 1000,
    words_2000: mastered >= 2000,
    streak_3: streak >= 3,
    streak_7: streak >= 7,
    streak_30: streak >= 30,
    accuracy_90: accuracy >= 0.9 && (totalCorrect + totalWrong) >= 20,
  };

  const unlocked = await dbGetAll('achievements');
  const unlockedKeys = new Set(unlocked.map(a => a.key));

  for (const [key, cond] of Object.entries(thresholds)) {
    if (cond && !unlockedKeys.has(key)) {
      await dbPut('achievements', { key });
    }
  }
}

// ==================== Profile ====================
async function renderProfile(container, data) {
  const tab = data?.tab || 'info';
  const settings = await getSettings();

  container.innerHTML = `
    <div class="text-center" style="padding:20px 0">
      <div style="width:64px;height:64px;border-radius:50%;background:var(--accent);margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:28px;color:#fff">
        ${(App.username || '?')[0].toUpperCase()}
      </div>
      <h3 class="mt-8">${App.username || '用户'}</h3>
      <p class="text-muted" style="font-size:11px">离线模式 · 数据存储在本机</p>
    </div>

    <div class="flex-center gap-8 mb-16" style="flex-wrap:wrap">
      <button class="btn-sm ${tab==='info'?'':'transparent'}" style="${tab!=='info'?'background:transparent;border:1px solid rgba(255,255,255,0.2)':''}" onclick="navigateTo('profile',{tab:'info'})">设置</button>
      <button class="btn-sm ${tab==='wrong'?'':'transparent'}" style="${tab!=='wrong'?'background:transparent;border:1px solid rgba(255,255,255,0.2)':''}" onclick="navigateTo('profile',{tab:'wrong'})">错题本</button>
      <button class="btn-sm ${tab==='fav'?'':'transparent'}" style="${tab!=='fav'?'background:transparent;border:1px solid rgba(255,255,255,0.2)':''}" onclick="navigateTo('profile',{tab:'fav'})">收藏夹</button>
      <button class="btn-sm ${tab==='import'?'':'transparent'}" style="${tab!=='import'?'background:transparent;border:1px solid rgba(255,255,255,0.2)':''}" onclick="navigateTo('profile',{tab:'import'})">导入导出</button>
    </div>
    <div id="profile-content"></div>
  `;

  const pc = document.getElementById('profile-content');
  switch (tab) {
    case 'wrong': await renderWrongWords(pc); break;
    case 'fav': await renderFavorites(pc); break;
    case 'import': renderImport(pc); break;
    default: renderSettings(pc, settings);
  }
}

function renderSettings(container, settings) {
  container.innerHTML = `
    <div class="card">
      <div class="setting-row">
        <div><div class="setting-label">每日目标</div><div class="setting-sublabel">每天学习单词数</div></div>
        <input type="number" class="setting-input" id="daily-goal" value="${settings.dailyGoal || 20}" min="5" max="200">
      </div>
      <button class="btn-sm mt-8" style="width:100%" onclick="saveSettings()">保存设置</button>
    </div>
    <div class="card mt-12">
      <div class="setting-row">
        <div><div class="setting-label">重置所有数据</div><div class="setting-sublabel">清除学习记录和设置，词库保留</div></div>
        <button class="btn-sm danger" onclick="resetData()">重置</button>
      </div>
    </div>
  `;
}

async function saveSettings() {
  const goal = parseInt(document.getElementById('daily-goal').value) || 20;
  const all = await dbGetAll('settings');
  const existing = all.find(s => s.key === 'dailyGoal');
  if (existing) { existing.value = String(goal); await dbPut('settings', existing); }
  else { await dbPut('settings', { key: 'dailyGoal', value: String(goal) }); }
  showToast('设置已保存');
}

async function resetData() {
  if (!confirm('确定要清除所有学习记录吗？词库数据会保留。')) return;
  await dbClear('userWords');
  await dbClear('studySessions');
  await dbClear('dailyStats');
  await dbClear('achievements');
  showToast('数据已重置');
  navigateTo('home');
}

async function renderWrongWords(container) {
  const uws = await dbGetAll('userWords');
  const wrongUws = uws.filter(u => u.wrong_count > 0).sort((a, b) => b.wrong_count - a.wrong_count);
  const allWords = await dbGetAll('words');

  if (!wrongUws.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🎉</div><p>错题本为空，继续保持！</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="card-title mb-8">📕 错题本 (${wrongUws.length})</div>
    <div class="word-list">
      ${wrongUws.slice(0, 100).map(uw => {
        const w = allWords.find(x => x.id === uw.wordId);
        if (!w) return '';
        return `<div class="word-item">
          <span class="word-english">${w.english}</span>
          <span class="word-phonetic">/${w.phonetic || ''}/</span>
          <span class="word-chinese">${(w.chinese || '').substring(0, 25)}</span>
          <span style="font-size:11px;color:var(--danger)">错${uw.wrong_count}次</span>
        </div>`;
      }).join('')}
    </div>
    <button class="btn-primary mt-12" style="width:100%" onclick="reviewWrongWords()">复习错题</button>
  `;
}

async function reviewWrongWords() {
  const uws = await dbGetAll('userWords');
  const wrongUws = uws.filter(u => u.wrong_count > 0).sort((a, b) => b.wrong_count - a.wrong_count);
  const allWords = await dbGetAll('words');

  App.studyWords = wrongUws.slice(0, 20).map(uw => {
    const w = allWords.find(x => x.id === uw.wordId);
    return { ...w, ...uw };
  }).filter(x => x.english);

  App.studyIndex = 0;
  App.studyCorrect = 0;
  App.studyWrong = 0;
  App.sessionStartTime = Date.now();

  if (App.studyWords.length === 0) {
    showToast('没有错题可复习');
    return;
  }

  showFlashcardWord(document.getElementById('main-content'));
}

async function renderFavorites(container) {
  const uws = await dbGetAll('userWords');
  const favUws = uws.filter(u => u.is_favorite);
  const allWords = await dbGetAll('words');

  if (!favUws.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">⭐</div><p>还没有收藏任何单词</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="card-title mb-8">⭐ 收藏夹 (${favUws.length})</div>
    <div class="word-list">
      ${favUws.map(uw => {
        const w = allWords.find(x => x.id === uw.wordId);
        if (!w) return '';
        return `<div class="word-item">
          <span class="word-english">${w.english}</span>
          <span class="word-phonetic">/${w.phonetic || ''}/</span>
          <span class="word-chinese">${(w.chinese || '').substring(0, 25)}</span>
          <span class="word-fav" onclick="event.stopPropagation();toggleFavorite(${w.id});renderFavorites(document.getElementById('profile-content'))">❤️</span>
        </div>`;
      }).join('')}
    </div>
  `;
}

function renderImport(container) {
  container.innerHTML = `
    <div class="card">
      <div class="card-title mb-8">📤 导出学习数据</div>
      <p class="text-dim mb-8" style="font-size:13px">备份你的学习记录到文件</p>
      <button class="btn-primary" style="width:100%" onclick="exportData()">导出 JSON</button>
    </div>
    <div class="card mt-12">
      <div class="card-title mb-8">📥 导入学习数据</div>
      <p class="text-dim mb-8" style="font-size:13px">从备份文件恢复学习记录</p>
      <input type="file" id="import-file" accept=".json" style="display:none" onchange="importData(event)">
      <button class="btn-primary" style="width:100%;background:var(--success)" onclick="document.getElementById('import-file').click()">导入 JSON</button>
    </div>
    <div class="card mt-12">
      <div class="card-title mb-8">📋 导入自定义词库</div>
      <div class="import-area">
        <div class="import-icon">📋</div>
        <div class="import-text">粘贴单词数据</div>
        <textarea id="import-text" placeholder="每行一个单词，格式：&#10;english [phonetic] chinese&#10;&#10;例如：&#10;abandon /əˈbændən/ 放弃；抛弃"></textarea>
        <input type="text" id="import-category" class="setting-input mt-8" style="width:100%" placeholder="词库名称" value="custom">
      </div>
      <button class="btn-primary mt-8" style="width:100%" onclick="importCustomWords()">导入词库</button>
      <div id="import-result" class="mt-8 text-center"></div>
    </div>
  `;
}

async function exportData() {
  const userWords = await dbGetAll('userWords');
  const studySessions = await dbGetAll('studySessions');
  const dailyStats = await dbGetAll('dailyStats');
  const settings = await dbGetAll('settings');
  const achievements = await dbGetAll('achievements');

  const data = { userWords, studySessions, dailyStats, settings, achievements, exportDate: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vocab-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('导出成功！');
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (data.userWords) for (const uw of data.userWords) await dbPut('userWords', uw);
    if (data.studySessions) for (const s of data.studySessions) await dbPut('studySessions', s);
    if (data.dailyStats) for (const d of data.dailyStats) await dbPut('dailyStats', d);
    if (data.settings) for (const s of data.settings) await dbPut('settings', s);
    if (data.achievements) for (const a of data.achievements) await dbPut('achievements', a);
    showToast('导入成功！');
    navigateTo('home');
  } catch (e) {
    showToast('文件格式错误');
  }
}

async function importCustomWords() {
  const text = document.getElementById('import-text').value.trim();
  const category = document.getElementById('import-category').value.trim() || 'custom';
  const resultEl = document.getElementById('import-result');
  if (!text) { resultEl.innerHTML = '<span class="error-msg">请粘贴单词数据</span>'; return; }

  let items = [];
  if (text.startsWith('[')) {
    try { items = JSON.parse(text); } catch (e) {
      resultEl.innerHTML = '<span class="error-msg">JSON 格式错误</span>'; return;
    }
  } else {
    const lines = text.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const match = line.match(/^([a-zA-Z]+)\s*(?:\[([^\]]*)\]\s*)?(.+)$/);
      if (match) items.push({ english: match[1], phonetic: match[2] || '', chinese: match[3].trim() });
    }
  }

  if (!items.length) { resultEl.innerHTML = '<span class="error-msg">未能解析到单词</span>'; return; }

  let added = 0;
  const allWords = await dbGetAll('words');
  for (const item of items) {
    const exists = allWords.find(w => w.english === item.english.toLowerCase() && w.category === category);
    if (!exists) {
      await dbPut('words', {
        english: item.english.toLowerCase(),
        chinese: item.chinese || '',
        phonetic: item.phonetic || '',
        category
      });
      added++;
    }
  }
  resultEl.innerHTML = `<span class="success-msg">✅ 成功导入 ${added} 个单词到「${category}」词库</span>`;
}

// ==================== Utilities ====================
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

// ==================== Start ====================
document.addEventListener('DOMContentLoaded', initApp);

// Handle registration form
document.getElementById('btn-register').addEventListener('click', handleRegister);
document.getElementById('reg-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleRegister();
});
