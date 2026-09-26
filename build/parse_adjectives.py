#!/usr/bin/env python3
"""Parse the declined-adjectives PDF into JSON: english + MS/MP/FS/FP vocalized forms.

Each cell is wrapped in directional marks (U+202A/U+202B .. U+202C). Column cells are
separated by runs of 2+ spaces. Within a Hebrew cell the PDF extraction inserts spurious
single spaces around nikkud, so we strip all spaces inside Hebrew cells.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TXT = ROOT / "adj.txt"
DIR_MARKS = set(chr(c) for c in [0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069])
HEB_RE = re.compile(r"[֐-׿]")


def strip_marks(s):
    return "".join(ch for ch in s if ch not in DIR_MARKS)


def clean_heb(cell):
    # remove directional marks and ALL spaces (each cell is a single word)
    return "".join(ch for ch in cell if ch not in DIR_MARKS and not ch.isspace())


def parse():
    lines = TXT.read_text(encoding="utf-8").split("\n")
    out = []
    for l in lines:
        if not l.strip():
            continue
        low = strip_marks(l).strip()
        if low.startswith("English") or "Course Adjectives" in low or "Heilswahrheit" in low:
            continue
        cells = [c for c in re.split(r" {2,}", l.strip()) if c.strip()]
        if len(cells) < 5:
            continue
        english = strip_marks(cells[0]).strip()
        heb = [clean_heb(c) for c in cells[1:5]]
        if not english or not HEB_RE.search(heb[0]):
            continue
        out.append({
            "english": english,
            "forms": {"ms": heb[0], "mp": heb[1], "fs": heb[2], "fp": heb[3]},
        })
    return out


if __name__ == "__main__":
    data = parse()
    print(f"adjectives={len(data)}")
    for e in data[:6]:
        print(json.dumps(e, ensure_ascii=False))
    (ROOT / "build" / "adjectives_parsed.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
