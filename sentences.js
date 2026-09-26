/* Hebrew sentence generator — rule-based backbone + verified Ollama enhancement.
 * Loaded after app.js; uses globals ENTRIES, UNITS, currentUnit, speak, etc.
 * Correctness first: rule-based sentences enforce gender/number agreement from the
 * parsed conjugation + declension data, so they are always grammatical. LLM sentences
 * are constrained to in-scope vocabulary and rejected if they use unknown words.
 */
"use strict";
(function () {
  const NIKKUD = /[֑-ׇ]/g;
  const skel = s => (s || "").replace(NIKKUD, "").replace(/[־'".,!?]/g, "").trim();
  const sanit = s => (s || "").replace(/[׀׃׆]/g, "").replace(/\s+/g, " ").trim();  // drop paseq/sof-pasuq
  // Verbs that reliably take a bare (indefinite) direct object with no preposition.
  const TRANSITIVE = new Set(["eat", "drink", "write", "read", "see", "want", "buy", "cook", "wear",
    "open", "close", "bring", "take", "make", "give", "find", "build", "draw", "sing", "count",
    "wash", "cut", "break", "paint", "teach", "learn", "know", "hear", "love", "like", "prepare", "hold"]);
  const rnd = a => a[Math.floor(Math.random() * a.length)];
  const shuf = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // Pronoun table keyed by consonantal form. Present tense agreement needs only gender+number.
  const PRON = {
    "אני": { g: "c", n: "s", en: "I", be: "am", p: 1, nik: "אֲנִי", tr: "ani" },
    "אתה": { g: "m", n: "s", en: "you", be: "are", p: 2, nik: "אַתָּה", tr: "atah" },
    "את": { g: "f", n: "s", en: "you", be: "are", p: 2, nik: "אַתְּ", tr: "at" },
    "הוא": { g: "m", n: "s", en: "he", be: "is", p: 3, nik: "הוּא", tr: "hu" },
    "היא": { g: "f", n: "s", en: "she", be: "is", p: 3, nik: "הִיא", tr: "hi" },
    "אנחנו": { g: "c", n: "p", en: "we", be: "are", p: 1, nik: "אֲנַחְנוּ", tr: "anakhnu" },
    "אתם": { g: "m", n: "p", en: "you", be: "are", p: 2, nik: "אַתֶּם", tr: "atem" },
    "אתן": { g: "f", n: "p", en: "you", be: "are", p: 2, nik: "אַתֶּן", tr: "aten" },
    "הם": { g: "m", n: "p", en: "they", be: "are", p: 3, nik: "הֵם", tr: "hem" },
    "הן": { g: "f", n: "p", en: "they", be: "are", p: 3, nik: "הֵן", tr: "hen" },
  };
  const slotFor = (g, n) => (g === "c" ? rnd(["m", "f"]) : g) + n;

  const UNCOUNT = new Set(["water", "bread", "milk", "wine", "coffee", "tea", "meat", "flesh", "rice",
    "sugar", "salt", "oil", "cheese", "butter", "money", "food", "soup", "juice", "beer", "snow", "rain"]);

  const firstSyn = s => (s || "").replace(/\(.*?\)/g, "").split(/[;,/]/)[0].trim();
  // Reduce a possibly-inflected English verb (glosses are inconsistent: "Write" vs "Opens")
  // to its base form so we can re-conjugate consistently.
  function deInflect(w) {
    if (/ies$/.test(w)) return w.slice(0, -3) + "y";
    if (/(ses|xes|zes|ches|shes|oes)$/.test(w)) return w.slice(0, -2);
    if (/ss$/.test(w)) return w;
    if (/s$/.test(w)) return w.slice(0, -1);
    return w;
  }
  function cleanVerb(s) {
    const w = firstSyn(s).replace(/^to\s+/i, "").toLowerCase().trim().split(/\s+/);
    w[0] = deInflect(w[0]);
    return w.join(" ");
  }
  const cleanNoun = s => firstSyn(s).toLowerCase().trim();
  const cleanAdj = s => firstSyn(s).toLowerCase().trim();
  function third1(v) {
    if (/([sxzo]|ch|sh)$/.test(v)) return v + "es";
    if (/[^aeiou]y$/.test(v)) return v.slice(0, -1) + "ies";
    return v + "s";
  }
  function thirdS(base) { const w = base.split(" "); w[0] = third1(w[0]); return w.join(" "); }
  const artFor = w => (UNCOUNT.has(w) ? "" : (/^[aeiou]/.test(w) ? "an " : "a "));

  function W(plain, nikkud, translit, en) {
    const nik = sanit(nikkud || plain);
    let tr = (translit || "").trim();
    if (!tr && typeof translitFromNikkud === "function") tr = translitFromNikkud(nik);
    return { plain: sanit(plain), nikkud: nik, translit: tr, en: en || "" };
  }

  // ---- scope ----
  function scopeEntries(maxUnit) {
    return ENTRIES.filter(e => typeof e.unit === "number" && e.unit >= 1 && e.unit <= maxUnit);
  }
  function buckets(entries) {
    const b = { pron: [], verb: [], noun: [], adj: [] };
    for (const e of entries) {
      if (e.pos === "pronoun" && PRON[skel(e.forms[0].hebrew)]) b.pron.push(e);
      else if (e.pos === "verb") {
        const has = ["ms", "fs", "mp", "fp"].every(s => e.forms.find(f => f.slot === s));
        const clean = e.forms.filter(f => f.slot !== "infinitive").every(f => !/[\s־-]/.test(f.hebrew));
        if (has && clean) b.verb.push(e);
      } else if (e.pos === "noun" && e.forms[0] && !/[\s־-]/.test(e.forms[0].hebrew)
        && (e.forms.some(f => f.slot === "plural") || UNCOUNT.has(cleanNoun(e.english)))
        && /^[a-z][a-z ,'-]+$/i.test(firstSyn(e.english)) && !/^[mf]\.?[sp]\b/i.test(e.english.trim())) b.noun.push(e);
      else if (e.pos === "adjective" && e.declension) b.adj.push(e);
    }
    return b;
  }

  // ---- dictionary for verification + AI vocalization ----
  function buildDict(entries) {
    const dict = new Map();            // skeleton -> {nikkud, translit, en}
    const allowed = new Set();
    const add = (heb, nikkud, translit, en) => { const k = skel(heb); if (!k) return; allowed.add(k); if (!dict.has(k)) dict.set(k, { nikkud: nikkud || heb, translit: translit || "", en: en || "" }); };
    for (const e of entries) {
      for (const f of e.forms) add(f.hebrew, f.nikkud, f.translit, e.english);
      if (e.declension) for (const k of ["ms", "mp", "fs", "fp"]) add(e.declension[k], e.declension[k], "", e.english);
    }
    return { dict, allowed };
  }
  // function words the LLM may use freely
  const FUNC = new Set(["את", "של", "זה", "זאת", "יש", "אין", "לא", "כן", "גם", "מאוד", "אבל", "או", "כי",
    "עם", "בלי", "על", "אל", "מן", "לי", "לך", "לו", "לה", "לנו", "להם", "להן", "אצל", "כמו", "מה", "מי",
    "ה", "ו", "ב", "ל", "מ", "כ", "ש", "אני", "אתה", "את", "הוא", "היא", "אנחנו", "אתם", "אתן", "הם", "הן"]);
  const CLITIC = new Set(["ו", "ה", "ב", "ל", "מ", "כ", "ש"]);
  function inScope(token, allowed) {
    let t = skel(token);
    if (!t) return true;
    for (let strip = 0; strip <= 3; strip++) {
      if (allowed.has(t) || FUNC.has(t)) return true;
      if (t.length > 1 && CLITIC.has(t[0])) t = t.slice(1); else break;
    }
    return allowed.has(t) || FUNC.has(t);
  }
  function verify(hebrew, allowed) {
    const toks = (hebrew || "").split(/\s+/).filter(Boolean);
    const unknown = toks.filter(w => !inScope(w, allowed));
    return { ok: unknown.length === 0 && toks.length >= 2 && toks.length <= 9, unknown };
  }
  function vocalize(hebrew, dict) {
    return (hebrew || "").split(/\s+/).map(tok => {
      const k = skel(tok);
      if (dict.has(k) && NIKKUD.test(dict.get(k).nikkud)) return dict.get(k).nikkud;
      // try stripping one clitic
      if (k.length > 1 && CLITIC.has(k[0]) && dict.has(k.slice(1)) && NIKKUD.test(dict.get(k.slice(1)).nikkud))
        return k[0] + dict.get(k.slice(1)).nikkud;
      return tok;
    }).join(" ");
  }

  // ---- rule-based templates ----
  function sentObj(words, en, template) {
    return {
      he: words.map(w => w.plain).join(" "),
      heNikkud: words.map(w => w.nikkud).join(" "),
      translit: words.map(w => w.translit).filter(Boolean).join(" "),
      en: en.replace(/\s+/g, " ").trim().replace(/^./, c => c.toUpperCase()),
      words, source: "rule", template,
    };
  }

  function tplPronVerbObj(b) {
    if (!b.pron.length || !b.verb.length) return null;
    const pe = rnd(b.pron); const pk = PRON[skel(pe.forms[0].hebrew)];
    const s = slotFor(pk.g, pk.n);
    const ve = rnd(b.verb); const vf = ve.forms.find(f => f.slot === s);
    if (!vf) return null;
    const subj = W(skel(pk.nik), pk.nik, pk.tr, pk.en);
    const verb = W(vf.hebrew, vf.nikkud, vf.translit, cleanVerb(ve.english));
    const words = [subj, verb];
    const vbase = cleanVerb(ve.english);
    const vEn = (pk.p === 3 && pk.n === "s") ? thirdS(vbase) : vbase;
    let en = `${pk.en} ${vEn}`;
    let template = "pronoun+verb";
    // Add a bare direct object only for clearly-transitive verbs (avoids prepositional verbs).
    if (b.noun.length && TRANSITIVE.has(vbase) && Math.random() < 0.8) {
      const ne = rnd(b.noun); const nf = ne.forms[0]; const nen = cleanNoun(ne.english);
      words.push(W(nf.hebrew, nf.nikkud, nf.translit, nen));
      en += ` ${artFor(nen)}${nen}`;
      template = "pronoun+verb+object";
    }
    return sentObj(words, en, template);
  }

  function tplPronAdj(b) {
    if (!b.pron.length || !b.adj.length) return null;
    const pe = rnd(b.pron); const pk = PRON[skel(pe.forms[0].hebrew)];
    const s = slotFor(pk.g, pk.n);
    const ae = rnd(b.adj); const form = ae.declension[s];
    if (!form) return null;
    const subj = W(skel(pk.nik), pk.nik, pk.tr, pk.en);
    const adj = W(skel(form), form, "", cleanAdj(ae.english));
    return sentObj([subj, adj], `${pk.en} ${pk.be} ${cleanAdj(ae.english)}`, "pronoun+adjective");
  }

  // Rule batch uses only templates whose agreement is anchored on the pronoun, whose
  // gender/number is known exactly. (Noun-gender data is heuristic, so noun+adjective
  // agreement is left to the labelled AI path instead.)
  function ruleBatch(entries, count) {
    const b = buckets(entries);
    const tpls = [];
    if (b.pron.length && b.verb.length) tpls.push(tplPronVerbObj);
    if (b.pron.length && b.adj.length) tpls.push(tplPronAdj);
    if (!tpls.length) return [];
    const out = []; const seen = new Set(); let guard = 0;
    while (out.length < count && guard++ < count * 20) {
      const s = rnd(tpls)(b);
      if (s && !seen.has(s.he)) { seen.add(s.he); out.push(s); }
    }
    return out;
  }

  // ---- Ollama ----
  function cfg() {
    return {
      endpoint: (localStorage.getItem("ollamaEndpoint") || "http://localhost:11434").replace(/\/$/, ""),
      model: localStorage.getItem("ollamaModel") || "llama3:latest",
    };
  }
  async function ollamaTest(timeoutMs) {
    const c = cfg();
    const ctl = new AbortController();
    const t = timeoutMs ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const r = await fetch(c.endpoint + "/api/tags", { method: "GET", signal: ctl.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      return (d.models || []).map(m => m.name);
    } finally { if (t) clearTimeout(t); }
  }
  // Quick availability probe used to decide whether to offer the AI feature at all.
  async function probeOllama() {
    if (location.protocol === "file:") return false;   // a file:// page can't reach Ollama
    try { const m = await ollamaTest(2500); return m.length > 0; } catch { return false; }
  }
  function wordMenu(b, n) {
    const pick = (arr, k, fmt) => shuf(arr).slice(0, k).map(fmt);
    const lines = [];
    lines.push("Pronouns: " + pick(b.pron, 6, e => `${skel(e.forms[0].hebrew)} (${PRON[skel(e.forms[0].hebrew)].en})`).join(", "));
    lines.push("Verbs (present, m.s/f.s/m.p/f.p): " + pick(b.verb, 8, e => {
      const g = s => skel((e.forms.find(f => f.slot === s) || {}).hebrew || "");
      return `${cleanVerb(e.english)}=[${g("ms")}/${g("fs")}/${g("mp")}/${g("fp")}]`;
    }).join("; "));
    lines.push("Nouns: " + pick(b.noun, 14, e => `${skel(e.forms[0].hebrew)} (${cleanNoun(e.english)},${e.gender || "?"})`).join(", "));
    if (b.adj.length) lines.push("Adjectives (m.s/f.s): " + pick(b.adj, 8, e => `${cleanAdj(e.english)}=[${skel(e.declension.ms)}/${skel(e.declension.fs)}]`).join("; "));
    return lines.join("\n");
  }
  async function ollamaBatch(entries, count) {
    const c = cfg(); const b = buckets(entries);
    const { allowed } = buildDict(entries);
    const { dict } = buildDict(entries);
    const prompt =
`You are a modern Hebrew teacher. Using ONLY the vocabulary below (you may also use basic function words: the article ה, and ו, the object marker את, and prepositions ב/ל/מ/על/עם), write ${count} SHORT present-tense Hebrew sentences (3-7 words) that a beginner could understand.
Rules: correct gender/number agreement between subject and verb, and between noun and adjective. Do NOT use any word that is not in the list. Keep them simple and natural.

VOCABULARY:
${wordMenu(b, count)}

Respond ONLY as JSON: {"sentences":[{"hebrew":"...","english":"..."}, ...]}`;
    const r = await fetch(c.endpoint + "/api/generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: c.model, prompt, stream: false, format: "json", options: { temperature: 0.6, num_predict: 500 } }),
    });
    if (!r.ok) throw new Error("Ollama HTTP " + r.status);
    const d = await r.json();
    let parsed; try { parsed = JSON.parse(d.response); } catch { throw new Error("Model did not return JSON"); }
    const arr = parsed.sentences || parsed.data || (Array.isArray(parsed) ? parsed : []);
    const out = [];
    for (const s of arr) {
      const he = (s.hebrew || s.he || "").trim();
      const en = (s.english || s.en || "").trim();
      if (!he || !en) continue;
      const v = verify(he, allowed);
      if (!v.ok) continue;                       // reject out-of-scope / wrong-length
      const heNik = vocalize(he, dict);
      const heTok = he.split(/\s+/), nikTok = heNik.split(/\s+/);
      const tr = heTok.map((w, idx) => {
        const info = dict.get(w.replace(NIKKUD, ""));
        if (info && info.translit) return info.translit;
        return typeof translitFromNikkud === "function" ? translitFromNikkud(nikTok[idx] || w) : "";
      }).join(" ");
      out.push({ he, heNikkud: heNik, translit: tr, en, source: "ai", template: "llm", verified: true });
    }
    return out;
  }

  window.Sentences = { scopeEntries, buckets, ruleBatch, buildDict, verify, vocalize, ollamaTest, probeOllama, ollamaBatch, cfg, PRON };
})();
