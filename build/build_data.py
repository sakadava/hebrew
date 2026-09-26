#!/usr/bin/env python3
"""Merge parsed vocab + declined adjectives into one normalized dataset (data/vocab.json).

Normalized entry schema (also the CSV import target):
{
  "id": "u08-003",
  "unit": 8, "unitName": "Food 1", "category": "food",
  "pos": "noun|verb|adjective|pronoun|phrase|other",
  "english": "Fish",
  "gender": "m|f|null",
  "genderSource": "...|null",
  "binyan": "Qal|null",          # verbs only
  "root": null,                   # optional
  "forms": [ {"slot": "singular", "translit": "dag", "hebrew": "דג", "nikkud": null}, ... ],
  "source": "duolingo-vocab|duolingo-adjectives|import"
}
Verb slots: infinitive, ms, fs, mp, fp. Adjective slots: ms, mp, fs, fp.
Noun/other slots: singular, plural.
"""
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VOCAB = json.load(open(ROOT / "build" / "vocab_parsed.json", encoding="utf-8"))
ADJ = json.load(open(ROOT / "build" / "adjectives_parsed.json", encoding="utf-8"))

NIKKUD_RE = re.compile(r"[֑-ׇ]")


def strip_nikkud(s):
    return NIKKUD_RE.sub("", s or "").replace("‎", "").replace("‏", "").strip()


_EN_STOP = {"a", "an", "the", "to", "of", "or", "and", "is", "it", "m", "f", "s", "p", "pres"}


def en_words(s):
    s = re.sub(r"\(.*?\)", "", (s or "").lower())
    return {w for w in re.split(r"[^a-z]+", s) if len(w) > 2 and w not in _EN_STOP}


def en_overlap(a, b):
    return bool(en_words(a) & en_words(b))


def category_for(name):
    n = name.lower()
    tbl = [
        ("letters", ["letter"]), ("grammar", ["present", "past", "future", "infinitive", "imperative",
         "nifal", "passive", "reflexive", "conditional", "modal", "construct", "verbal noun", "formal"]),
        ("food", ["food"]), ("clothing", ["clothing"]), ("animals", ["animal"]),
        ("colours", ["colour", "color"]), ("family", ["family"]), ("home", ["home"]),
        ("numbers", ["number"]), ("time", ["time"]), ("weather", ["weather", "nature"]),
        ("places", ["place", "travel", "israel", "space"]), ("people", ["people", "occupation", "family"]),
        ("adjectives", ["adjective"]), ("prepositions", ["preposition", "conjunction", "determiner"]),
        ("questions", ["question"]), ("body", ["medical", "emergency"]),
    ]
    for cat, keys in tbl:
        if any(k in n for k in keys):
            return cat
    return "other"


# index adjectives by consonantal MS form for matching
adj_by_skel = {}
for a in ADJ:
    skel = strip_nikkud(a["forms"]["ms"])
    adj_by_skel.setdefault(skel, a)


def make_forms_noun(entry):
    forms = []
    s = entry["forms"]["singular"]
    forms.append({"slot": "singular", "translit": s.get("translit", ""), "hebrew": s.get("hebrew", ""), "nikkud": None})
    p = entry["forms"].get("plural")
    if p and p.get("hebrew"):
        forms.append({"slot": "plural", "translit": p.get("translit", ""), "hebrew": p.get("hebrew", ""), "nikkud": None})
    return forms


def make_forms_verb(entry):
    forms = []
    inf = entry.get("infinitive", {})
    forms.append({"slot": "infinitive", "translit": inf.get("translit", ""), "hebrew": inf.get("hebrew", ""), "nikkud": None})
    for slot in ("ms", "fs", "mp", "fp"):
        c = entry.get("conjugations", {}).get(slot)
        if c:
            forms.append({"slot": slot, "translit": c.get("translit", ""), "hebrew": c.get("hebrew", ""), "nikkud": None})
    return forms


def build():
    out = {"schemaVersion": 1, "source": "Duolingo Hebrew course vocabulary", "units": []}
    seq = 0
    for u in VOCAB["units"]:
        cat = category_for(u["name"])
        entries = []
        for e in u["entries"]:
            seq += 1
            eid = f"u{u['index']:02d}-{len(entries)+1:03d}"
            if e["type"] == "verb":
                item = {
                    "id": eid, "unit": u["index"], "unitName": u["name"], "category": cat,
                    "pos": "verb", "english": e["english"], "gender": None, "genderSource": None,
                    "binyan": e.get("binyan"), "root": None,
                    "forms": make_forms_verb(e), "source": "duolingo-vocab",
                }
            else:
                pos = "pronoun" if e["type"] == "pronoun" else ("adjective" if e["type"] == "adjective" else "noun")
                forms = make_forms_noun(e)
                item = {
                    "id": eid, "unit": u["index"], "unitName": u["name"], "category": cat,
                    "pos": pos, "english": e["english"], "gender": e.get("gender"),
                    "genderSource": e.get("genderSource"), "binyan": None, "root": None,
                    "forms": forms, "source": "duolingo-vocab",
                }
                # try to attach adjective declension + nikkud — but only when the English
                # glosses overlap too, so homographs (e.g. noun "Oil" שמן vs adjective
                # "fat" שמן) don't get wrongly declined by gender.
                skel = strip_nikkud(forms[0]["hebrew"])
                match = adj_by_skel.get(skel)
                if match and en_overlap(item["english"], match["english"]):
                    item["pos"] = "adjective"
                    item["gender"] = item["gender"] or "m"
                    item["declension"] = match["forms"]
                    # nikkud on base form
                    forms[0]["nikkud"] = match["forms"]["ms"]
            entries.append(item)
        out["units"].append({"index": u["index"], "name": u["name"], "category": cat, "entries": entries})

    # Also add a dedicated Adjectives reference bank (full declension, nikkud) for adjectives
    # not already present in vocab units.
    seen_skels = set()
    for u in out["units"]:
        for e in u["entries"]:
            if e.get("declension"):
                seen_skels.add(strip_nikkud(e["forms"][0]["hebrew"]))
    extra = []
    for a in ADJ:
        skel = strip_nikkud(a["forms"]["ms"])
        if skel in seen_skels:
            continue
        eid = f"adj-{len(extra)+1:03d}"
        extra.append({
            "id": eid, "unit": 0, "unitName": "Adjective Bank", "category": "adjectives",
            "pos": "adjective", "english": a["english"], "gender": "m", "genderSource": "declension",
            "binyan": None, "root": None,
            "forms": [{"slot": "ms", "translit": "", "hebrew": strip_nikkud(a["forms"]["ms"]), "nikkud": a["forms"]["ms"]}],
            "declension": a["forms"], "source": "duolingo-adjectives",
        })
    if extra:
        out["units"].append({"index": 0, "name": "Adjective Bank", "category": "adjectives", "entries": extra})
    return out


if __name__ == "__main__":
    data = build()
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data" / "vocab.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    total = sum(len(u["entries"]) for u in data["units"])
    withdecl = sum(1 for u in data["units"] for e in u["entries"] if e.get("declension"))
    print(f"units={len(data['units'])} entries={total} adjectives_with_declension={withdecl}")
