#!/usr/bin/env python3
"""Auto-vocalize (nikkud) every Hebrew form via the Dicta Nakdan API.

Batches unique consonantal forms (newline-separated), takes the top vocalization per
word, reconstructs each form, caches to build/nikkud_cache.json, and writes the nikkud
back into data/vocab.json. Marks results as auto-generated. Degrades gracefully: any
form that fails keeps nikkud=null and the app falls back to transliteration.
"""
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "vocab.json"
CACHE = ROOT / "build" / "nikkud_cache.json"
API = "https://nakdan-2-0.loadbalancer.dicta.org.il/api"
NIKKUD_RE = re.compile(r"[֑-ׇ]")
HEB_RE = re.compile(r"[א-ת]")
BATCH = 60


def has_heb(s):
    return bool(HEB_RE.search(s or ""))


def call_api(text):
    body = json.dumps({"task": "nakdan", "data": text, "genre": "modern"}).encode("utf-8")
    req = urllib.request.Request(API, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


def vocalize_batch(forms):
    """forms: list of consonantal strings. Returns dict form->nikkud."""
    text = "\n".join(forms)
    tokens = call_api(text)
    # split tokens into groups separated by newline sep tokens
    groups, cur = [], []
    for t in tokens:
        if t.get("sep") and "\n" in (t.get("word") or ""):
            groups.append(cur)
            cur = []
        else:
            cur.append(t)
    groups.append(cur)
    result = {}
    if len(groups) != len(forms):
        return None  # alignment mismatch -> caller falls back to per-form
    for form, grp in zip(forms, groups):
        parts = []
        for t in grp:
            if t.get("sep"):
                parts.append(t.get("word", ""))
            else:
                opts = t.get("options") or []
                parts.append(opts[0] if opts else t.get("word", ""))
        result[form] = "".join(parts).strip()
    return result


def main():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    cache = {}
    if CACHE.exists():
        cache = json.loads(CACHE.read_text(encoding="utf-8"))

    # collect unique forms that need nikkud and lack existing nikkud
    need = set()
    for u in data["units"]:
        for e in u["entries"]:
            for f in e["forms"]:
                heb = f["hebrew"]
                if has_heb(heb) and not f.get("nikkud") and heb not in cache:
                    need.add(heb)
    need = sorted(need)
    print(f"forms needing nikkud: {len(need)} (cached: {len(cache)})", file=sys.stderr)

    batches = [need[i:i + BATCH] for i in range(0, len(need), BATCH)]
    for bi, batch in enumerate(batches):
        got = None
        for attempt in range(2):
            try:
                got = vocalize_batch(batch)
                if got is not None:
                    break
            except Exception as ex:
                print(f"  batch {bi} attempt {attempt} error: {ex}", file=sys.stderr)
                time.sleep(1.5)
        if got is None:
            # fall back: vocalize one at a time
            for form in batch:
                try:
                    one = vocalize_batch([form])
                    if one:
                        cache.update(one)
                except Exception:
                    pass
        else:
            cache.update(got)
        if bi % 5 == 0:
            CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"  batch {bi+1}/{len(batches)} done ({len(cache)} cached)", file=sys.stderr)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")

    # apply
    applied = 0
    for u in data["units"]:
        for e in u["entries"]:
            for f in e["forms"]:
                if not f.get("nikkud") and f["hebrew"] in cache:
                    nk = cache[f["hebrew"]]
                    if nk and NIKKUD_RE.search(nk):
                        f["nikkud"] = nk
                        f["nikkudAuto"] = True
                        applied += 1
    DATA.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"applied nikkud to {applied} forms", file=sys.stderr)


if __name__ == "__main__":
    main()
