"""Parse raw word list TXT files into structured JSON."""
import json
import re
import os

RAW_DIR = "raw"
OUT_DIR = "data/words"
os.makedirs(OUT_DIR, exist_ok=True)

# Common pattern: word [phonetic] definition
WORD_RE = re.compile(
    r"^([a-zA-Z][a-zA-Z\s.\-']+?)\s*\[([^\]]+)\]\s*(.+)$"
)

def parse_any(text, category):
    """Generic parser for word lists in the format: english [phonetic] definition"""
    words = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        # Skip header/title lines
        if line[0] not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ":
            continue
        # Skip single-letter section headers
        if len(line) <= 3 and line.isascii() and line.isalpha():
            continue
        # Remove leading number (some files have numbering like "25 accelerate...")
        line = re.sub(r"^\d+\s+", "", line)
        m = WORD_RE.match(line)
        if m:
            english = m.group(1).strip().lower()
            # Remove trailing 's or 't from abbreviations
            english = english.strip("'")
            phonetic = m.group(2).strip()
            definition = m.group(3).strip()
            definition = re.sub(r"\s+", " ", definition)
            if len(english) >= 1 and len(definition) >= 1:
                words.append({
                    "english": english,
                    "phonetic": phonetic,
                    "chinese": definition,
                    "category": category
                })
    return words


def deduplicate(words):
    """Remove duplicate words, keeping first occurrence."""
    seen = set()
    result = []
    for w in words:
        if w["english"] not in seen:
            seen.add(w["english"])
            result.append(w)
    return result


def main():
    files = [
        ("raw/CET4_full.txt", "cet4"),
        ("raw/CET6.txt", "cet6"),
        ("raw/kaoyan_raw.txt", "kaoyan"),
    ]

    all_counts = {}
    for path, category in files:
        print(f"Parsing {category} from {path}...")
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        words = parse_any(text, category)
        words = deduplicate(words)
        all_counts[category] = len(words)
        print(f"  Parsed {len(words)} words")
        out_path = os.path.join(OUT_DIR, f"{category}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(words, f, ensure_ascii=False)
        print(f"  Saved to {out_path}")

    print("\n=== Summary ===")
    for cat, count in all_counts.items():
        with open(os.path.join(OUT_DIR, f"{cat}.json"), "r", encoding="utf-8") as f:
            data = json.load(f)
        print(f"{cat}: {len(data)} words")
        if data:
            print(f"  Sample: {data[0]}")


if __name__ == "__main__":
    main()
