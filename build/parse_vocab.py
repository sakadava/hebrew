#!/usr/bin/env python3
"""Parse the Duolingo Hebrew vocab PDF (via pdftotext -layout) into structured JSON.

Columns are separated by runs of 2+ spaces. Rows are grouped into 84 topic-units.
Verbs appear as an infinitive row (english has a binyan tag like "(Qal)") followed by
M.S./F.S./M.P./F.P. conjugation rows. Nouns appear as singular[+plural] pairs.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TXT = ROOT / "vocab.txt"

HEB_RE = re.compile(r"[֐-׿]")
NIKKUD_RE = re.compile(r"[֑-ׇ]")
DIR_MARKS = "".join(chr(c) for c in [0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069])

BINYANIM = ["Qal", "Nifal", "Piel", "Pual", "Hifil", "Hufal", "Hitpael", "Nif'al", "Pi'el", "Pu'al", "Hif'il", "Huf'al", "Hitpa'el"]
CONJ_LABELS = {"M.S.": "ms", "F.S.": "fs", "M.P.": "mp", "F.P.": "fp",
               "M.S": "ms", "F.S": "fs", "M.P": "mp", "F.P": "fp"}


def clean(s: str) -> str:
    return "".join(ch for ch in s if ch not in DIR_MARKS).strip()


def has_hebrew(s: str) -> bool:
    return bool(HEB_RE.search(s))


def split_cols(line: str):
    """Split a layout line into cells on runs of 2+ spaces."""
    parts = re.split(r" {2,}", line.strip())
    return [p.strip() for p in parts if p.strip()]


def load_units():
    lines = TXT.read_text(encoding="utf-8").split("\n")
    # Find header rows ("English ... Transliteration ... Hebrew"); the unit title is
    # the nearest non-empty line above.
    units = []
    header_idxs = [i for i, l in enumerate(lines) if "Transliteration" in l and "English" in l]
    for n, hi in enumerate(header_idxs):
        j = hi - 1
        while j > 0 and not lines[j].strip():
            j -= 1
        title = clean(lines[j])
        end = header_idxs[n + 1] - 1 if n + 1 < len(header_idxs) else len(lines)
        # trim trailing lines that belong to next unit's title
        body = lines[hi + 1:end]
        units.append({"index": n + 1, "name": title, "raw_lines": body})
    return units


def parse_row(line):
    """Return (english, translit, hebrew) or None."""
    cells = split_cols(line)
    if not cells:
        return None
    # find the hebrew cell (last cell containing hebrew chars); everything before is en+translit
    heb_idx = None
    for k in range(len(cells) - 1, -1, -1):
        if has_hebrew(cells[k]):
            heb_idx = k
            break
    if heb_idx is None:
        return None  # no hebrew -> skip (footers, stray lines)
    hebrew = clean(" ".join(cells[heb_idx:]))
    left = cells[:heb_idx]
    if len(left) == 0:
        return None
    if len(left) == 1:
        # only one latin cell -> could be a label-only conj row missing translit; treat as english
        return (left[0], "", hebrew)
    # english = first cell, translit = remaining cells joined
    english = left[0]
    translit = " ".join(left[1:])
    return (english, translit, hebrew)


def detect_binyan(english):
    for b in BINYANIM:
        if re.search(r"\(" + re.escape(b) + r"\)", english):
            return b
    return None


def split_forms(translit, hebrew):
    """Best-effort split of 'singular plural' pairs.
    Hebrew: split on spaces; if 2 tokens -> sing/plural. Translit similarly.
    For multi-word phrases we cannot reliably split, so keep whole as singular.
    """
    ht = hebrew.split()
    tt = translit.split()
    sing = {"translit": translit, "hebrew": hebrew}
    plur = None
    # Clean case: exactly 2 hebrew tokens and 2 translit tokens
    if len(ht) == 2 and len(tt) == 2:
        sing = {"translit": tt[0], "hebrew": ht[0]}
        plur = {"translit": tt[1], "hebrew": ht[1]}
    elif len(ht) == 2 and len(tt) != 2:
        # hebrew clearly split, translit ambiguous
        sing = {"translit": tt[0] if tt else "", "hebrew": ht[0]}
        plur = {"translit": " ".join(tt[1:]) if len(tt) > 1 else "", "hebrew": ht[1]}
    return sing, plur


def guess_gender(english, sing_heb, plur_heb):
    # explicit marker in english
    m = re.search(r"\((m|f)\.?\s*[sp]", english.lower())
    if m:
        return m.group(1), "marker"
    if plur_heb:
        if plur_heb.endswith("ות"):
            return "f", "plural-ending"
        if plur_heb.endswith("ים"):
            return "m", "plural-ending"
        if plur_heb.endswith("יים"):
            return None, None  # dual, ambiguous
    if sing_heb:
        if sing_heb.endswith("ה") or sing_heb.endswith("ת"):
            return "f", "singular-ending"
    return None, None


PRONOUNS = {"ani", "atah", "at", "hu", "hi", "anakhnu", "anachnu", "atem", "aten", "hem", "hen", "ata"}


def classify(english, translit, binyan):
    e = english.lower()
    if binyan or re.search(r"\bto\b", e) and "(" in english:
        return "verb"
    if english in CONJ_LABELS:
        return "conj-label"
    if translit.strip() in PRONOUNS:
        return "pronoun"
    if re.search(r"\((m|f)\.?[sp]", e) and "pres" not in e:
        # adjective-like gendered single form (e.g., Hungry (m.s))
        return "adjective"
    return "noun"


# ---- Past/future tense conjugation grouping ----
# Bare person labels (no verb meaning) that continue a preceding verb's past/future paradigm.
BARE_PERSON = {
    "i": "1cs",
    "you (m.s)": "2ms", "you (f.s)": "2fs",
    "he/it": "3ms", "he": "3ms", "she/it": "3fs", "she": "3fs",
    "we": "1cp", "they": "3mp", "they (m)": "3mp", "they (f)": "3fp",
    "you (m.p)": "2mp", "you (f.p)": "2fp",
}
def bare_person_slot(english):
    return BARE_PERSON.get(english.strip().lower())

def unit_tense(name):
    n = name.lower()
    if "future" in n:
        return "future"
    if "past" in n:
        return "past"
    return None

def clean_tense_english(s, tense):
    t = re.sub(r"\(.*?\)", "", s).strip()
    t = re.sub(r"^i\s+(will|shall|was|were|am|have|had)?\s*", "", t, flags=re.I).strip()
    t = t.rstrip(";, ").strip()
    if not t:
        t = re.sub(r"\(.*?\)", "", s).strip()
    return f"{t} ({tense})"

def tense_verb_from_lemma(lemma, tense):
    """Turn the entry preceding a run of person rows into a tense verb (its form = the 1cs form)."""
    if lemma.get("type") == "verb":
        f = lemma.get("infinitive", {}) or {}
        binyan = lemma.get("binyan")
    else:
        f = (lemma.get("forms", {}) or {}).get("singular", {}) or {}
        binyan = None
    tv = {"type": "verb", "tense": tense, "english": clean_tense_english(lemma.get("english", ""), tense),
          "binyan": binyan, "forms_person": {}}
    if f.get("hebrew"):
        tv["forms_person"]["1cs"] = {"translit": f.get("translit", ""), "hebrew": f.get("hebrew", "")}
    return tv


def parse():
    units = load_units()
    out_units = []
    for u in units:
        entries = []
        pending_verb = None
        tense = unit_tense(u["name"])
        tense_verb = None
        for line in u["raw_lines"]:
            if not line.strip():
                continue
            row = parse_row(line)
            if not row:
                continue
            english, translit, hebrew = row
            # skip stray header repeats / footers
            if english.lower() in ("english",) or "heilswahrheit" in english.lower():
                continue
            # Past/future paradigm: bare person rows continue the preceding verb lemma.
            if tense:
                bslot = bare_person_slot(english)
                if bslot:
                    if tense_verb is None:
                        lemma = entries.pop() if entries else None
                        tense_verb = tense_verb_from_lemma(lemma, tense) if lemma else \
                            {"type": "verb", "tense": tense, "english": clean_tense_english(english, tense), "binyan": None, "forms_person": {}}
                        entries.append(tense_verb)
                    fp = tense_verb["forms_person"]
                    if bslot == "2ms" and "2ms" in fp:   # duplicate "You (m.s)" label → treat 2nd as 2fs
                        bslot = "2fs"
                    fp[bslot] = {"translit": translit, "hebrew": hebrew}
                    continue
                tense_verb = None   # a non-person row ends the paradigm
            # conjugation label row -> attach to pending verb
            label = CONJ_LABELS.get(english.rstrip("."))
            if label is None:
                label = CONJ_LABELS.get(english)
            if label and pending_verb is not None:
                pending_verb["conjugations"][label] = {"translit": translit, "hebrew": hebrew}
                continue
            # present-tense conjugation rows written as "Come(s) (m.s - pres.)" etc.
            pm = re.search(r"\((m|f)\.?\s*([sp])\b", english, re.I)
            if pm and re.search(r"pres", english, re.I):
                pslot = pm.group(1).lower() + pm.group(2).lower()
                if pending_verb is None:
                    lemma = re.sub(r"\(.*?\)", "", english).strip()
                    lemma = re.sub(r"\(s\)$", "", lemma).strip() or english
                    pending_verb = {"type": "verb", "english": lemma, "binyan": None,
                                    "infinitive": {"translit": "", "hebrew": ""}, "conjugations": {}}
                    entries.append(pending_verb)
                pending_verb["conjugations"][pslot] = {"translit": translit, "hebrew": hebrew}
                continue
            binyan = detect_binyan(english)
            if binyan is not None or re.search(r"\((Qal|Nifal|Piel|Pual|Hifil|Hufal|Hitpael|Nif'al|Pi'el|Pu'al|Hif'il|Huf'al|Hitpa'el)\)", english):
                # start a verb
                pending_verb = {
                    "type": "verb",
                    "english": english,
                    "binyan": binyan,
                    "infinitive": {"translit": translit, "hebrew": hebrew},
                    "conjugations": {},
                }
                entries.append(pending_verb)
                continue
            # otherwise a noun/adjective/pronoun/other
            pending_verb = None
            sing, plur = split_forms(translit, hebrew)
            gender, gsrc = guess_gender(english, sing["hebrew"], plur["hebrew"] if plur else "")
            pos = classify(english, translit, None)
            entries.append({
                "type": pos if pos in ("pronoun", "adjective") else "noun",
                "english": english,
                "gender": gender,
                "genderSource": gsrc,
                "forms": {"singular": sing, "plural": plur},
            })
        out_units.append({"index": u["index"], "name": u["name"], "entries": entries})
    return {"units": out_units}


if __name__ == "__main__":
    data = parse()
    total = sum(len(u["entries"]) for u in data["units"])
    verbs = sum(1 for u in data["units"] for e in u["entries"] if e["type"] == "verb")
    print(f"units={len(data['units'])} entries={total} verbs={verbs}", file=sys.stderr)
    out = ROOT / "build" / "vocab_parsed.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print("wrote", out, file=sys.stderr)
