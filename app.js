/* Ivrit — Hebrew vocabulary trainer. Vanilla JS, no build step. */
"use strict";

// ---------- Data ----------
const DATA = window.VOCAB || { units: [] };
const NIKKUD_RE = /[֑-ׇ]/;

function loadCustom() {
  try { return JSON.parse(localStorage.getItem("customWords") || "[]"); }
  catch { return []; }
}
function saveCustom(arr) { localStorage.setItem("customWords", JSON.stringify(arr)); }

// Flat list of all entries (built once, refreshed when custom words change)
let ENTRIES = [];
let UNITS = [];
function rebuildEntries() {
  ENTRIES = [];
  UNITS = DATA.units.map(u => ({ index: u.index, name: u.name, category: u.category, entries: [] }));
  const byIdx = Object.fromEntries(UNITS.map(u => [u.index, u]));
  for (const u of DATA.units) {
    for (const e of u.entries) {
      const item = { ...e };
      ENTRIES.push(item);
      byIdx[u.index].entries.push(item);
    }
  }
  const custom = loadCustom();
  if (custom.length) {
    const cu = { index: 999, name: "My Words", category: "custom", entries: [] };
    for (const e of custom) { ENTRIES.push(e); cu.entries.push(e); }
    UNITS.push(cu);
  }
}
rebuildEntries();

// ---------- Settings / progress ----------
const S = {
  get(k, d) { const v = localStorage.getItem("set:" + k); return v === null ? d : JSON.parse(v); },
  set(k, v) { localStorage.setItem("set:" + k, JSON.stringify(v)); },
};
const toggles = {
  nikkud: S.get("nikkud", true),
  translit: S.get("translit", true),
  english: S.get("english", true),
};
let currentUnit = S.get("currentUnit", 8); // user self-sets their frontier

// SRS (Leitner). boxes: 0..5. progress[id] = {box, due, seen, correct}
const PROG = JSON.parse(localStorage.getItem("progress") || "{}");
function saveProg() { localStorage.setItem("progress", JSON.stringify(PROG)); }
const DAY = 86400000;
const INTERVALS = [0, 1, 2, 4, 8, 16, 32].map(d => d * DAY);
function prog(id) { return PROG[id] || (PROG[id] = { box: 0, due: 0, seen: 0, correct: 0 }); }
function grade(id, ok) {
  const p = prog(id); p.seen++;
  if (ok) { p.correct++; p.box = Math.min(6, p.box + 1); }
  else { p.box = Math.max(0, p.box - 1); }
  p.due = Date.now() + INTERVALS[p.box];
  saveProg();
}

// ---------- Speech ----------
let VOICES = [];
let chosenVoice = null;
function loadVoices() {
  VOICES = speechSynthesis.getVoices().filter(v => /he|iw/i.test(v.lang));
  const sel = document.getElementById("voiceSelect");
  sel.innerHTML = "";
  if (!VOICES.length) {
    const o = document.createElement("option"); o.textContent = "No Hebrew voice"; sel.appendChild(o);
    sel.disabled = true; return;
  }
  sel.disabled = false;
  VOICES.forEach((v, i) => { const o = document.createElement("option"); o.value = i; o.textContent = v.name; sel.appendChild(o); });
  const saved = S.get("voice", 0);
  sel.value = Math.min(saved, VOICES.length - 1);
  chosenVoice = VOICES[sel.value] || VOICES[0];
}
if ("speechSynthesis" in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}
function speak(text) {
  if (!text || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "he-IL";
  if (chosenVoice) u.voice = chosenVoice;
  u.rate = 0.85;
  speechSynthesis.speak(u);
}

// ---------- Display helpers ----------
function hebOf(form) {
  if (toggles.nikkud && form.nikkud && NIKKUD_RE.test(form.nikkud)) return form.nikkud;
  return form.hebrew;
}
function primaryForm(e) {
  // the canonical citation form
  const order = ["singular", "ms", "infinitive"];
  for (const s of order) { const f = e.forms.find(x => x.slot === s); if (f) return f; }
  return e.forms[0];
}
function speakForm(e) { const f = primaryForm(e); speak(f.nikkud || f.hebrew); }

const SLOT_LABEL = { singular: "Singular", plural: "Plural", infinitive: "Infinitive",
  ms: "he (m.s)", fs: "she (f.s)", mp: "they (m.p)", fp: "they (f.p)" };
const POS_LABEL = { noun: "noun", verb: "verb", adjective: "adj", pronoun: "pron", phrase: "phrase", other: "" };

function genderPill(e) {
  if (e.pos === "verb") return `<span class="pill verb">verb${e.binyan ? " · " + e.binyan : ""}</span>`;
  if (e.gender === "m") return `<span class="pill m">masculine</span>`;
  if (e.gender === "f") return `<span class="pill f">feminine</span>`;
  return `<span class="pill ${e.pos}">${POS_LABEL[e.pos] || e.pos}</span>`;
}
function esc(s) { return (s || "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
function escAttr(s) { return (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
// A Hebrew table cell that speaks its form when clicked.
function sayCell(text, sayText) {
  return `<td class="heb hebrew say" data-say="${escAttr(sayText || text)}" title="Click to hear">${esc(text)} <span class="mini-speak">🔊</span>${typeGlyph(stripN(sayText || text), "he")}</td>`;
}
// Wire every .say element under root to speak its data-say text on click.
function bindSay(root) {
  root.querySelectorAll(".say").forEach(el => el.onclick = ev => {
    if (ev.target.closest(".type-trigger, .type-box")) return;  // let the type widget handle its own clicks
    ev.stopPropagation(); speak(el.dataset.say);
  });
}

// ---------- Type-to-check widget (a ⌨ that mirrors the 🔊) ----------
const FINALS = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
function normHe(s) {
  s = (s || "").replace(/[֑-ׇ]/g, "").replace(/[‎‏‪-‮]/g, "");
  s = [...s].map(c => FINALS[c] || c).filter(c => /[א-ת ]/.test(c)).join("");
  return s.replace(/\s+/g, " ").trim();
}
function normEn(s) {
  return (s || "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z ]/g, " ")
    .replace(/\b(to|a|an|the)\b/g, " ").replace(/\s+/g, " ").trim();
}
function matchAnswer(input, ans, lang) {
  if (lang === "he") { const i = normHe(input); return i !== "" && i === normHe(ans); }
  const opts = (ans || "").split(/[;,/]/).map(normEn).filter(Boolean);
  const i = normEn(input);
  return i !== "" && opts.includes(i);
}
// ⌨ trigger markup — answer is what you must type, lang is "he" or "en"
function typeGlyph(answer, lang) {
  return `<span class="type-trigger" role="button" tabindex="0" title="Type it to check" data-ans="${escAttr(answer)}" data-lang="${lang}">⌨</span>`;
}
function makeTypeBox(ans, lang, onDone) {
  const box = document.createElement("span");
  box.className = "type-box";
  box.innerHTML = `<input class="type-in" dir="${lang === "he" ? "rtl" : "ltr"}" placeholder="${lang === "he" ? "הקלד/י…" : "type…"}" autocomplete="off" autocorrect="off" spellcheck="false"><button class="type-check" title="Check (Enter)">✓</button><button class="type-reveal" title="Reveal answer">👁</button><span class="type-fb"></span>`;
  const input = box.querySelector(".type-in");
  const fb = box.querySelector(".type-fb");
  const answerHtml = `<span class="ans ${lang === "he" ? "hebrew" : ""}">${esc(ans)}</span>`;
  const check = () => {
    const ok = matchAnswer(input.value, ans, lang);
    input.classList.toggle("ok", ok); input.classList.toggle("bad", !ok);
    fb.className = "type-fb " + (ok ? "ok" : "bad");
    fb.innerHTML = ok ? "✓ correct" : `✗ ${answerHtml}`;   // wrong shows the answer; your text stays
    if (ok && onDone) onDone();
  };
  const reveal = () => {
    fb.className = "type-fb reveal";
    fb.innerHTML = `answer: ${answerHtml}`;                 // shows answer, leaves your typing untouched
  };
  box.querySelector(".type-check").onclick = check;
  box.querySelector(".type-reveal").onclick = reveal;
  input.addEventListener("keydown", ev => {
    ev.stopPropagation();
    if (ev.key === "Enter") { ev.preventDefault(); check(); }
    else if (ev.key === "Escape") { box.remove(); if (view === "lesson") relayoutLesson(); }
  });
  return { box, focus: () => input.focus() };
}
// One delegated listener toggles a type box for any ⌨ trigger. Inside a lesson card the box
// is appended at the card's bottom (full width, never clipped by the dense grid cells);
// elsewhere (flashcard/sentence prompts) it opens inline next to the icon.
document.addEventListener("click", ev => {
  const t = ev.target.closest(".type-trigger");
  if (!t) return;
  ev.stopPropagation(); ev.preventDefault();
  const open = document.querySelector(".type-box");
  const wasThis = open && open._owner === t;
  document.querySelectorAll(".type-box").forEach(b => b.remove());
  if (wasThis) { if (view === "lesson") relayoutLesson(); return; }
  const { box, focus } = makeTypeBox(t.dataset.ans, t.dataset.lang);
  box._owner = t;
  const card = t.closest(".le-card");
  if (card) { box.classList.add("type-box-block"); card.appendChild(box); }
  else { t.after(box); }
  focus();
  if (view === "lesson") relayoutLesson();
});
// Speak a list of Hebrew strings one after another (uses the built-in queue).
function speakSequence(texts) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  for (const t of texts) {
    if (!t) continue;
    const u = new SpeechSynthesisUtterance(t);
    u.lang = "he-IL"; if (chosenVoice) u.voice = chosenVoice; u.rate = 0.85;
    speechSynthesis.speak(u);
  }
}

// ---------- Toast ----------
let toastT;
function toast(msg) {
  const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 1800);
}

// ---------- Router ----------
const app = document.getElementById("app");
let view = "lesson";
function closeMenu() {
  const m = document.getElementById("menu"); if (m) m.classList.remove("open");
  const h = document.getElementById("hamburger"); if (h) h.setAttribute("aria-expanded", "false");
}
function setView(v) {
  view = v;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  const active = v === "session" ? "learn" : v;
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.view === active));
  closeMenu();
  render();
}
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => setView(b.dataset.view));
document.getElementById("homeBtn").onclick = () => setView("lesson");
// Hamburger menu (mobile)
const _hb = document.getElementById("hamburger");
if (_hb) _hb.onclick = () => {
  const m = document.getElementById("menu");
  const open = m.classList.toggle("open");
  _hb.setAttribute("aria-expanded", open ? "true" : "false");
};

// toggle wiring
for (const key of ["nikkud", "translit", "english"]) {
  const el = document.getElementById("t" + key[0].toUpperCase() + key.slice(1));
  el.checked = toggles[key];
  el.onchange = () => { toggles[key] = el.checked; S.set(key, el.checked); render(); };
}
document.getElementById("voiceSelect").onchange = e => {
  chosenVoice = VOICES[e.target.value]; S.set("voice", +e.target.value);
};

// ================= LEARN =================
const learnState = {
  units: new Set(S.get("learnUnits", [])),
  pos: new Set(S.get("learnPos", ["noun", "verb", "adjective", "pronoun"])),
  slots: new Set(S.get("learnSlots", ["singular", "plural", "ms"])),
  mode: S.get("learnMode", "en2he"),
  onlyDue: S.get("onlyDue", false),
};

function poolFor() {
  let pool = ENTRIES.filter(e => learnState.pos.has(e.pos));
  if (learnState.units.size) pool = pool.filter(e => learnState.units.has(e.unit));
  if (learnState.onlyDue) pool = pool.filter(e => (prog(e.id).due || 0) <= Date.now());
  return pool;
}

function renderLearnSetup() {
  const pool = poolFor();
  const posCounts = {};
  for (const e of ENTRIES) posCounts[e.pos] = (posCounts[e.pos] || 0) + 1;
  const unitChips = UNITS.map(u => {
    const on = learnState.units.has(u.index);
    return `<div class="chip ${on ? "on" : ""}" data-unit="${u.index}">${esc(u.name)}<span class="cnt">${u.entries.length}</span></div>`;
  }).join("");
  const posChips = ["noun", "verb", "adjective", "pronoun"].map(p =>
    `<div class="chip ${learnState.pos.has(p) ? "on" : ""}" data-pos="${p}">${p}<span class="cnt">${posCounts[p] || 0}</span></div>`).join("");
  const modes = [["en2he", "English → Hebrew"], ["he2en", "Hebrew → English"], ["listen", "Listen → recall"]];
  const modeChips = modes.map(([v, l]) => `<div class="chip ${learnState.mode === v ? "on" : ""}" data-mode="${v}">${l}</div>`).join("");

  const due = ENTRIES.filter(e => (prog(e.id).due || 0) <= Date.now() && prog(e.id).seen > 0).length;
  const learned = ENTRIES.filter(e => prog(e.id).box >= 4).length;

  app.innerHTML = `
    <div class="row" style="margin-bottom:16px">
      <div class="stat"><b>${ENTRIES.length}</b><span>words</span></div>
      <div class="stat"><b>${learned}</b><span>learned</span></div>
      <div class="stat"><b>${due}</b><span>due review</span></div>
      <div class="spacer"></div>
      <button class="btn ghost" id="quickReview">Review due (${due})</button>
    </div>
    <div class="card-panel">
      <h2>Build a study session</h2>
      <h3>Mode</h3><div class="chipbox" id="modeBox">${modeChips}</div>
      <h3>Word types</h3><div class="chipbox" id="posBox">${posChips}</div>
      <h3>Units <span class="muted" style="text-transform:none">— pick some, or leave empty for all. Your current lesson is highlighted in Browse.</span></h3>
      <div class="chipbox" id="unitBox">${unitChips}</div>
      <h3>Options</h3>
      <div class="row">
        <label class="chk"><input type="checkbox" id="onlyDue" ${learnState.onlyDue ? "checked" : ""}> Only words due for review</label>
      </div>
      <div class="row" style="margin-top:20px">
        <button class="btn primary" id="startBtn">Start · ${pool.length} words</button>
        <span class="muted">Space = flip · 1 = again · 2 = got it</span>
      </div>
    </div>`;

  document.getElementById("unitBox").onclick = e => {
    const c = e.target.closest("[data-unit]"); if (!c) return;
    const idx = +c.dataset.unit;
    if (learnState.units.has(idx)) learnState.units.delete(idx); else learnState.units.add(idx);
    S.set("learnUnits", [...learnState.units]); renderLearnSetup();
  };
  document.getElementById("posBox").onclick = e => {
    const c = e.target.closest("[data-pos]"); if (!c) return;
    const p = c.dataset.pos;
    if (learnState.pos.has(p)) learnState.pos.delete(p); else learnState.pos.add(p);
    S.set("learnPos", [...learnState.pos]); renderLearnSetup();
  };
  document.getElementById("modeBox").onclick = e => {
    const c = e.target.closest("[data-mode]"); if (!c) return;
    learnState.mode = c.dataset.mode; S.set("learnMode", learnState.mode); renderLearnSetup();
  };
  document.getElementById("onlyDue").onchange = e => { learnState.onlyDue = e.target.checked; S.set("onlyDue", e.target.checked); renderLearnSetup(); };
  document.getElementById("startBtn").onclick = () => startSession(poolFor());
  document.getElementById("quickReview").onclick = () => {
    const duePool = ENTRIES.filter(e => (prog(e.id).due || 0) <= Date.now() && prog(e.id).seen > 0);
    if (!duePool.length) return toast("Nothing due — go learn something new!");
    startSession(duePool);
  };
}

// ------------- Flashcard session -------------
let session = null;
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }

function startSession(pool) {
  if (!pool.length) return toast("No words match — widen your filters.");
  // order: due first (by box asc), then unseen, capped for a comfortable session
  const deck = shuffle([...pool]).sort((a, b) => prog(a.id).box - prog(b.id).box).slice(0, 40);
  session = { deck, i: 0, flipped: false, right: 0, wrong: 0, mode: learnState.mode };
  view = "session"; renderSession();
}

const stripN = s => (s || "").replace(/[֑-ׇ]/g, "");
const dispHeb = nik => (toggles.nikkud ? nik : stripN(nik));  // respect the nikkud toggle

// Approximate transliteration from a vocalized (nikkud) Hebrew string — used to fill in
// transliteration where the source data has none (e.g. adjective declensions). Not perfect,
// but consistent and readable; the audio button gives the authoritative pronunciation.
function translitFromNikkud(s) {
  if (!s) return "";
  const A = [...s]; let out = "";
  const V = { 0x05B0: "'", 0x05B1: "e", 0x05B2: "a", 0x05B3: "o", 0x05B4: "i", 0x05B5: "e", 0x05B6: "e", 0x05B7: "a", 0x05B8: "a", 0x05B9: "o", 0x05BA: "o", 0x05BB: "u", 0x05C7: "o" };
  const C = { 0x05D0: "", 0x05D1: "v", 0x05D2: "g", 0x05D3: "d", 0x05D4: "h", 0x05D5: "v", 0x05D6: "z", 0x05D7: "kh", 0x05D8: "t", 0x05D9: "y", 0x05DA: "kh", 0x05DB: "kh", 0x05DC: "l", 0x05DD: "m", 0x05DE: "m", 0x05DF: "n", 0x05E0: "n", 0x05E1: "s", 0x05E2: "", 0x05E3: "f", 0x05E4: "f", 0x05E5: "tz", 0x05E6: "tz", 0x05E7: "k", 0x05E8: "r", 0x05E9: "sh", 0x05EA: "t" };
  for (let i = 0; i < A.length; i++) {
    const code = A[i].codePointAt(0);
    if (code < 0x05D0 || code > 0x05EA) { if (A[i] === " ") out += " "; else if (A[i] === "-" || A[i] === "־") out += "-"; continue; }
    let j = i + 1, dagesh = false, shin = false, sin = false, holam = false, hasVowel = false, vowel = "";
    while (j < A.length) {
      const m = A[j].codePointAt(0);
      if (m === 0x05BC) { dagesh = true; j++; continue; }
      if (m === 0x05C1) { shin = true; j++; continue; }
      if (m === 0x05C2) { sin = true; j++; continue; }
      if (m === 0x05B9) { holam = true; vowel = "o"; hasVowel = true; j++; continue; }
      if (m in V) { vowel = V[m]; hasVowel = true; j++; continue; }
      if (m >= 0x0591 && m <= 0x05C7) { j++; continue; }
      break;
    }
    // holam male: a bare vav after a holam-marked consonant is a mater — skip it
    if (holam && j < A.length && A[j].codePointAt(0) === 0x05D5) {
      const nm = j + 1 < A.length ? A[j + 1].codePointAt(0) : 0;
      const carries = nm === 0x05BC || (nm >= 0x05B0 && nm <= 0x05BB) || nm === 0x05B9 || nm === 0x05C7;
      if (!carries) j++;
    }
    if (code === 0x05D5) { // vav: holam→o, shuruk→u, else consonant v
      if (holam) { out += "o"; i = j - 1; continue; }
      if (dagesh && !hasVowel) { out += "u"; i = j - 1; continue; }
    }
    if (code === 0x05D9 && !hasVowel && /[ie]$/.test(out)) { i = j - 1; continue; } // yod mater
    if (code === 0x05D4 && !hasVowel && j >= A.length) { i = j - 1; continue; }      // silent final he
    let cons;
    if (code === 0x05D1) cons = dagesh ? "b" : "v";
    else if (code === 0x05DB || code === 0x05DA) cons = dagesh ? "k" : "kh";
    else if (code === 0x05E4 || code === 0x05E3) cons = dagesh ? "p" : "f";
    else if (code === 0x05E9) cons = sin ? "s" : "sh";
    else cons = C[code] || "";
    out += cons + (hasVowel ? vowel : "");
    i = j - 1;
  }
  return out.replace(/'{2,}/g, "'").replace(/^'|'$/g, "").trim();
}

// One cell of the 2×2 gender/number grid.
function gridCell(nik, tr) {
  if (!nik) return "<td></td>";
  const t = toggles.translit ? (tr || translitFromNikkud(nik)) : "";
  return `<td class="heb hebrew say" data-say="${escAttr(nik)}" title="Click to hear">${esc(dispHeb(nik))} <span class="mini-speak">🔊</span>${typeGlyph(stripN(nik), "he")}${t ? `<div class="translit">${esc(t)}</div>` : ""}</td>`;
}
function grid2x2(map) {
  return `<table class="formtable">
    <tr><th></th><th>Masculine</th><th>Feminine</th></tr>
    <tr><th>singular</th>${gridCell(map.ms && map.ms.nik, map.ms && map.ms.tr)}${gridCell(map.fs && map.fs.nik, map.fs && map.fs.tr)}</tr>
    <tr><th>plural</th>${gridCell(map.mp && map.mp.nik, map.mp && map.mp.tr)}${gridCell(map.fp && map.fp.nik, map.fp && map.fp.tr)}</tr>
  </table>`;
}

function conjTable(e) {
  if (e.pos === "verb") {
    const byslot = s => e.forms.find(x => x.slot === s);
    const map = {};
    for (const s of ["ms", "fs", "mp", "fp"]) { const f = byslot(s); if (f) map[s] = { nik: f.nikkud || f.hebrew, tr: f.translit }; }
    return grid2x2(map);   // infinitive is shown by the caller (lesson card / flashcard front)
  }
  if (e.declension) {
    const map = {};
    for (const s of ["ms", "fs", "mp", "fp"]) map[s] = { nik: e.declension[s], tr: translitFromNikkud(e.declension[s]) };
    return grid2x2(map);
  }
  // noun singular/plural
  if (e.forms.length > 1) {
    const rows = e.forms.map(f =>
      `<tr><th>${SLOT_LABEL[f.slot] || f.slot}</th>${sayCell(hebOf(f), f.nikkud || f.hebrew)}${toggles.translit ? `<td class="translit">${esc(f.translit || translitFromNikkud(f.nikkud || ""))}</td>` : ""}</tr>`).join("");
    return `<table class="formtable">${rows}</table>`;
  }
  return "";
}

function renderSession() {
  const s = session;
  if (s.i >= s.deck.length) {
    app.innerHTML = `<div class="card-panel deck-done">
      <h2>Session complete 🎉</h2>
      <p class="muted">${s.right} correct · ${s.wrong} to revisit · ${s.deck.length} cards</p>
      <div class="row" style="justify-content:center;margin-top:16px">
        <button class="btn primary" id="again">New session</button>
        <button class="btn" id="back">Back to setup</button>
      </div></div>`;
    document.getElementById("again").onclick = () => startSession(poolFor());
    document.getElementById("back").onclick = () => setView("learn");
    return;
  }
  const e = s.deck[s.i];
  const f = primaryForm(e);
  const pct = Math.round((s.i / s.deck.length) * 100);
  let front, back;
  if (s.mode === "he2en") {
    front = `<div class="big-heb hebrew">${esc(hebOf(f))}</div>${toggles.translit ? `<div class="translit">${esc(f.translit)}</div>` : ""}`;
    back = `<div class="big-en">${esc(e.english)}</div>`;
  } else if (s.mode === "listen") {
    front = `<button class="speakbtn" id="playFront">▶</button><div class="hint">Listen, then flip</div>`;
    back = `<div class="big-heb hebrew">${esc(hebOf(f))}</div>${toggles.translit ? `<div class="translit">${esc(f.translit)}</div>` : ""}<div class="big-en" style="font-size:26px">${esc(e.english)}</div>`;
  } else {
    front = `<div class="big-en">${esc(e.english)}</div>`;
    back = `<div class="big-heb hebrew">${esc(hebOf(f))}</div>${toggles.translit ? `<div class="translit">${esc(f.translit)}</div>` : ""}`;
  }
  // Front gets a "type the answer" option: HE→EN → type English; otherwise → type Hebrew.
  const tAns = s.mode === "he2en" ? [e.english, "en"] : [stripN(f.hebrew), "he"];
  front += `<div class="type-prompt"><span class="hint">or type the answer</span> ${typeGlyph(tAns[0], tAns[1])}</div>`;
  const auto = f.nikkudAuto && toggles.nikkud ? `<div class="auto-note">nikkud auto-generated — may need a human check</div>` : "";
  const extra = s.flipped ? conjTable(e) : "";
  app.innerHTML = `
    <div class="stage">
      <div class="progressbar" style="max-width:620px"><i style="width:${pct}%"></i></div>
      <div class="row" style="max-width:620px;width:100%">
        <span class="muted">${s.i + 1} / ${s.deck.length}</span>
        <span class="spacer"></span>
        ${genderPill(e)}
        <span class="pill">${esc(e.unitName)}</span>
      </div>
      <div class="flash" id="flash">
        ${s.flipped ? back + `<button class="speakbtn" id="speak">🔊</button>` + extra + auto : front}
        ${!s.flipped ? `<div class="hint">click or press space to flip</div>` : ""}
      </div>
      ${s.flipped ? `<div class="row" style="justify-content:center">
        <button class="btn bad" id="again">Again</button>
        <button class="btn good" id="good">Got it</button>
      </div>` : `<div class="row"><button class="btn" id="flip2">Flip</button></div>`}
      <button class="btn ghost" id="quit">Exit session</button>
    </div>`;

  const flip = () => { s.flipped = true; renderSession(); if (s.mode !== "he2en") speakForm(e); };
  document.getElementById("flash").onclick = ev => {
    if (ev.target.closest(".type-trigger, .type-box")) return;   // typing widget handles itself
    const cell = ev.target.closest(".say");
    if (cell) { ev.stopPropagation(); speak(cell.dataset.say); return; }
    if (ev.target.closest("#speak,#playFront")) return;
    if (!s.flipped) flip();
  };
  const f2 = document.getElementById("flip2"); if (f2) f2.onclick = flip;
  const pf = document.getElementById("playFront"); if (pf) pf.onclick = () => speakForm(e);
  const sp = document.getElementById("speak"); if (sp) sp.onclick = () => speakForm(e);
  document.getElementById("quit").onclick = () => setView("learn");
  const g = document.getElementById("good"), ag = document.getElementById("again");
  if (g) g.onclick = () => { grade(e.id, true); s.right++; s.i++; s.flipped = false; renderSession(); };
  if (ag) ag.onclick = () => { grade(e.id, false); s.wrong++; s.i++; s.flipped = false; renderSession(); };
  if (s.mode === "listen" && !s.flipped) speakForm(e);
}

document.addEventListener("keydown", e => {
  if (view !== "session" || !session) return;
  if (e.key === " ") { e.preventDefault(); if (!session.flipped) { session.flipped = true; renderSession(); if (session.mode !== "he2en") speakForm(session.deck[session.i]); } }
  else if (session.flipped && e.key === "1") document.getElementById("again")?.click();
  else if (session.flipped && e.key === "2") document.getElementById("good")?.click();
});

// ================= LESSON (basic lesson mode) =================
let lessonUnit = null;

function unitLabel(u) {
  const n = (u.index === 0 || u.index === 999) ? "★" : String(u.index).padStart(2, "0");
  return `${n} · ${u.name}`;
}

function lineForm(slot, f) {
  const t = toggles.translit && f.translit ? `<span class="translit">${esc(f.translit)}</span>` : "";
  return `<div class="le-line">
    <span class="le-slot">${SLOT_LABEL[slot] || slot}</span>
    <span class="heb hebrew say" data-say="${escAttr(f.nikkud || f.hebrew)}" title="Click to hear">${esc(hebOf(f))} <span class="mini-speak">🔊</span></span>
    ${typeGlyph(stripN(f.hebrew), "he")}${t}
  </div>`;
}

function lessonEntry(e) {
  const head = `<div class="le-head"><span class="le-en">${esc(e.english)}</span>${typeGlyph(stripN(primaryForm(e).hebrew), "he")}${genderPill(e)}</div>`;
  const table = conjTable(e); // conjugations (verbs), declension (adj), or sing/plural (nouns)
  let primary = "";
  if (e.pos === "verb") {
    const inf = e.forms.find(f => f.slot === "infinitive");
    if (inf) primary = lineForm("infinitive", inf);
  } else if (!table) {
    const f = primaryForm(e);
    primary = lineForm(f.slot, f);
  }
  return `<div class="le-card masonry-item pos-${e.pos}">${head}${primary}${table}</div>`;
}

// ---- Pronoun tables: subject, object, possessive, prepositional (to/for), reflexive ----
// Each is the same person × gender × number grid; forms are placed by parsing the English gloss,
// and the whole set grows cumulatively as lessons introduce more forms.
const SUBJECT_SET = new Set(["אני", "אתה", "את", "הוא", "היא", "אנחנו", "אתם", "אתן", "הם", "הן"]);
const OBJECT_SET = new Set(["אותי", "אותך", "אותו", "אותה", "אותנו", "אתכם", "אתכן", "אותם", "אותן"]);
const PREP_SET = new Set(["לי", "לך", "לו", "לה", "לנו", "לכם", "לכן", "להם", "להן"]);
const PRON_CATS = [
  ["subject", "Subject — I, you, he…"],
  ["object", "Object — me, you, him…"],
  ["possessive", "Possessive — my, your, his…"],
  ["prepositional", "To / for — to me, to you…"],
  ["reflexive", "Reflexive — myself, yourself…"],
];
function pronCategoryOf(cons) {
  if (cons.startsWith("של")) return "possessive";
  if (cons.startsWith("עצמ")) return "reflexive";
  if (OBJECT_SET.has(cons)) return "object";
  if (PREP_SET.has(cons)) return "prepositional";
  if (SUBJECT_SET.has(cons)) return "subject";
  return null;
}
// Parse an English pronoun gloss into a grid cell key (person/number/gender). null if not a pronoun.
function pronCellKey(en) {
  const e = " " + en.toLowerCase() + " ";
  let person = null, num = null, g = null;
  if (/\b(i|my|me|mine|myself)\b/.test(e)) { person = 1; num = "s"; g = "c"; }
  else if (/\b(we|our|ours|us|ourselves)\b/.test(e)) { person = 1; num = "p"; g = "c"; }
  else if (/\b(he|his|him|himself)\b/.test(e)) { person = 3; num = "s"; g = "m"; }
  else if (/\b(she|her|hers|herself)\b/.test(e)) { person = 3; num = "s"; g = "f"; }
  else if (/\b(they|their|theirs|them|themselves)\b/.test(e)) { person = 3; num = "p"; }
  else if (/\b(you|your|yours|thee|ye|yourself|yourselves)\b/.test(e)) { person = 2; }
  if (person === null) return null;
  const par = (en.match(/\(([^)]*)\)/) || [])[1] || "";
  if (/m/.test(par)) g = "m";
  if (/f/.test(par)) g = "f";
  if (/p/.test(par)) num = "p";
  if (/s/.test(par)) num = "s";
  if (/selves/.test(e)) num = "p";
  if (num === null) num = "s";
  if (person !== 1 && g === null) g = "m";
  return person === 1 ? (num === "s" ? "1s" : "1p") : `${person}${num}${g}`;
}
function pronTdG(map, key, colspan) {
  const o = map[key];
  const cs = colspan ? ` colspan="${colspan}"` : "";
  if (!o) return `<td class="pron-empty"${cs}></td>`;
  const nik = o.nik;
  const tr = toggles.translit ? `<div class="translit">${esc(o.tr || translitFromNikkud(nik))}</div>` : "";
  return `<td class="heb hebrew say pron-cell"${cs} data-say="${escAttr(nik)}" title="Click to hear">${esc(dispHeb(nik))} <span class="mini-speak">🔊</span>${typeGlyph(stripN(nik), "he")}${tr}<div class="pron-en">${esc(o.en)}</div></td>`;
}
function pronGridFrom(map) {
  return `<table class="formtable prongrid">
    <tr><th></th><th>Masculine</th><th>Feminine</th></tr>
    <tr class="grp"><th colspan="3">Singular</th></tr>
    <tr><th>1st</th>${pronTdG(map, "1s", 2)}</tr>
    <tr><th>2nd</th>${pronTdG(map, "2sm")}${pronTdG(map, "2sf")}</tr>
    <tr><th>3rd</th>${pronTdG(map, "3sm")}${pronTdG(map, "3sf")}</tr>
    <tr class="grp"><th colspan="3">Plural</th></tr>
    <tr><th>1st</th>${pronTdG(map, "1p", 2)}</tr>
    <tr><th>2nd</th>${pronTdG(map, "2pm")}${pronTdG(map, "2pf")}</tr>
    <tr><th>3rd</th>${pronTdG(map, "3pm")}${pronTdG(map, "3pf")}</tr>
  </table>`;
}
function pronClassify(e) {
  const f = primaryForm(e);
  const cons = stripN(f.hebrew).replace(/[^א-ת]/g, "");   // pure consonants (drops "(-" etc.)
  const cat = pronCategoryOf(cons);
  if (!cat) return null;
  const key = pronCellKey(e.english);
  if (!key) return null;
  return { cat, key, cell: { nik: f.nikkud || f.hebrew, tr: f.translit, en: e.english } };
}

// Build ONE dense masonry of all cards, with pronoun tables (subject/object/possessive/…) first.
function lessonSections(u) {
  const byPos = { verb: [], adjective: [], noun: [], other: [] };
  for (const e of u.entries) {
    if (e.pos === "pronoun") continue;
    if (pronClassify(e)) continue;                 // pronoun-forms go into the pronoun tables, not here
    (byPos[e.pos] || byPos.other).push(e);
  }
  // Pronoun categories, cumulative up to (and including) the viewed lesson — never ahead.
  const cats = { subject: {}, object: {}, possessive: {}, prepositional: {}, reflexive: {} };
  for (const e of ENTRIES) {
    if (!(typeof e.unit === "number" && e.unit >= 1 && e.unit <= u.index)) continue;
    const c = pronClassify(e);
    if (c && !cats[c.cat][c.key]) cats[c.cat][c.key] = c.cell;
  }
  const cards = [];
  for (const [cat, title] of PRON_CATS) {
    if (Object.keys(cats[cat]).length) {
      cards.push(`<div class="le-card masonry-item pos-pronoun pron-card">
        <div class="le-head"><span class="le-en">${esc(title)}</span><span class="pill">up to here</span></div>
        ${pronGridFrom(cats[cat])}</div>`);
    }
  }
  for (const pos of ["verb", "adjective", "noun", "other"]) for (const e of byPos[pos]) cards.push(lessonEntry(e));
  if (!cards.length) return `<p class="muted">No words in this lesson.</p>`;
  return `<div class="masonry" id="lessonMasonry">${cards.join("")}</div>`;
}

// JS masonry: quantise each card's measured height into row spans so cards pack tightly in 2D.
function layoutMasonry(c) {
  if (!c) return;
  const unit = 6, gap = 12;
  const items = c.querySelectorAll(".masonry-item");
  items.forEach(it => { it.style.gridRowEnd = "auto"; });
  items.forEach(it => {
    const h = it.getBoundingClientRect().height;
    it.style.gridRowEnd = "span " + Math.max(1, Math.ceil((h + gap) / unit));
  });
}
function relayoutLesson() {
  const c = document.getElementById("lessonMasonry");
  if (c) layoutMasonry(c);
}

function renderLesson() {
  if (lessonUnit === null) lessonUnit = currentUnit;
  const list = UNITS;
  let pos = list.findIndex(u => u.index === lessonUnit);
  if (pos < 0) { pos = 0; lessonUnit = list[0].index; }
  const u = list[pos];
  const isCurrent = u.index === currentUnit;
  const options = list.map(x => `<option value="${x.index}" ${x.index === u.index ? "selected" : ""}>${esc(unitLabel(x))}</option>`).join("");

  app.innerHTML = `
    <div class="row" style="margin-bottom:14px;gap:8px">
      <button class="btn ghost" id="prevLesson" ${pos === 0 ? "disabled" : ""}>← Prev</button>
      <select id="lessonSelect" style="font-size:15px;min-width:220px">${options}</select>
      <button class="btn ghost" id="nextLesson" ${pos === list.length - 1 ? "disabled" : ""}>Next →</button>
      ${isCurrent ? `<span class="pill" style="color:var(--accent2);border-color:var(--accent2)">📍 current lesson</span>`
        : `<button class="btn ghost" id="setCurrent">Set as current</button>`}
      <span class="spacer"></span>
      <button class="btn ghost" id="playAll" title="Read every word in order">▶ Play all</button>
      <button class="btn ghost" id="stopAll">■ Stop</button>
      <button class="btn" id="studyLesson">Study as flashcards</button>
    </div>
    <div class="row" style="margin-bottom:12px">
      <h2 style="margin:0">${esc(u.name)}</h2>
      <span class="pill">${u.entries.length} items</span>
      <span class="muted">Everything in this lesson — nothing more. Click any word to hear it.</span>
    </div>
    ${lessonSections(u)}`;

  const go = idx => { lessonUnit = list[Math.max(0, Math.min(list.length - 1, idx))].index; speechSynthesis.cancel(); renderLesson(); };
  document.getElementById("prevLesson").onclick = () => go(pos - 1);
  document.getElementById("nextLesson").onclick = () => go(pos + 1);
  document.getElementById("lessonSelect").onchange = e => { lessonUnit = +e.target.value; speechSynthesis.cancel(); renderLesson(); };
  const sc = document.getElementById("setCurrent");
  if (sc) sc.onclick = () => { currentUnit = u.index; S.set("currentUnit", u.index); senti.built = false; toast("Marked as your current lesson"); renderLesson(); };
  document.getElementById("studyLesson").onclick = () => { learnState.units = new Set([u.index]); S.set("learnUnits", [u.index]); setView("learn"); };
  document.getElementById("playAll").onclick = () => speakSequence(u.entries.map(e => { const f = primaryForm(e); return f.nikkud || f.hebrew; }));
  document.getElementById("stopAll").onclick = () => speechSynthesis.cancel();
  bindSay(app);
  requestAnimationFrame(relayoutLesson);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayoutLesson);
}

let _resizeT;
window.addEventListener("resize", () => {
  if (view !== "lesson") return;
  clearTimeout(_resizeT); _resizeT = setTimeout(relayoutLesson, 120);
});
window.addEventListener("orientationchange", () => { if (view === "lesson") setTimeout(relayoutLesson, 200); });

// ================= BROWSE =================
let browseUnit = null;
let browseSort = { key: "english", dir: 1 };
function renderBrowse() {
  if (browseUnit === null) { renderUnitGrid(); return; }
  const u = UNITS.find(x => x.index === browseUnit);
  const rows = [...u.entries].sort((a, b) => {
    const av = a.english.toLowerCase(), bv = b.english.toLowerCase();
    return (av < bv ? -1 : av > bv ? 1 : 0) * browseSort.dir;
  });
  app.innerHTML = `
    <div class="row" style="margin-bottom:14px">
      <button class="btn ghost" id="backGrid">← All units</button>
      <h2 style="margin:0">${esc(u.name)}</h2>
      <span class="pill">${u.entries.length} words</span>
      <span class="spacer"></span>
      <button class="btn" id="studyUnit">Study this unit</button>
    </div>
    <table class="list">
      <thead><tr><th>English</th><th>Hebrew</th><th>Translit</th><th>Type</th><th>Forms</th><th></th></tr></thead>
      <tbody>${rows.map(rowHtml).join("")}</tbody>
    </table>`;
  document.getElementById("backGrid").onclick = () => { browseUnit = null; render(); };
  document.getElementById("studyUnit").onclick = () => {
    learnState.units = new Set([u.index]); S.set("learnUnits", [u.index]); setView("learn");
  };
  app.querySelectorAll("[data-speak]").forEach(el => el.onclick = () => {
    const e = u.entries.find(x => x.id === el.dataset.speak); speakForm(e);
  });
}

function rowHtml(e) {
  const f = primaryForm(e);
  const others = e.forms.filter(x => x !== f).map(x => `${SLOT_LABEL[x.slot] || x.slot}: <span class="hebrew">${esc(hebOf(x))}</span>`).join(" · ");
  return `<tr>
    <td>${esc(e.english)}</td>
    <td class="heb hebrew">${esc(hebOf(f))}</td>
    <td class="translit">${toggles.translit ? esc(f.translit) : ""}</td>
    <td>${genderPill(e)}</td>
    <td class="muted" style="font-size:13px">${others}</td>
    <td><span class="mini-speak" data-speak="${e.id}">🔊</span></td>
  </tr>`;
}

function renderUnitGrid() {
  const cards = UNITS.map(u => {
    const learned = u.entries.filter(e => prog(e.id).box >= 4).length;
    const pct = u.entries.length ? Math.round(learned / u.entries.length * 100) : 0;
    const cur = u.index === currentUnit ? "current" : "";
    return `<div class="unitcard ${cur}" data-unit="${u.index}">
      <div class="num">${u.index === 999 || u.index === 0 ? "★" : String(u.index).padStart(2, "0")} · ${esc(u.category)}</div>
      <div class="nm">${esc(u.name)}${cur ? " · 📍 here" : ""}</div>
      <div class="meta">${u.entries.length} words · ${learned} learned</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </div>`;
  }).join("");
  app.innerHTML = `
    <div class="row" style="margin-bottom:8px">
      <h2 style="margin:0">Units</h2>
      <span class="muted">Tap a unit to browse or study. Set 📍 to mark the lesson you're currently on.</span>
    </div>
    <div class="grid">${cards}</div>`;
  app.querySelector(".grid").onclick = e => {
    const c = e.target.closest("[data-unit]"); if (!c) return;
    const idx = +c.dataset.unit;
    if (e.shiftKey) { currentUnit = idx; S.set("currentUnit", idx); senti.built = false; toast("Marked as your current lesson"); renderUnitGrid(); return; }
    browseUnit = idx; render();
  };
  // long-press / right-click to set current
  app.querySelectorAll("[data-unit]").forEach(c => c.oncontextmenu = ev => {
    ev.preventDefault(); currentUnit = +c.dataset.unit; S.set("currentUnit", currentUnit); senti.built = false;
    toast("Marked as current lesson"); renderUnitGrid();
  });
}

// ================= PATTERNS =================
function renderPatterns() {
  // Verbs by binyan
  const verbs = ENTRIES.filter(e => e.pos === "verb");
  const byBinyan = {};
  for (const v of verbs) (byBinyan[v.binyan || "—"] ??= []).push(v);
  // Nouns by plural pattern
  const nouns = ENTRIES.filter(e => e.pos === "noun");
  const patt = { "masculine -ים": [], "feminine -ות": [], "dual -יים": [], "irregular / other": [] };
  for (const n of nouns) {
    const pl = n.forms.find(f => f.slot === "plural");
    if (!pl) continue;
    if (pl.hebrew.endsWith("יים")) patt["dual -יים"].push(n);
    else if (pl.hebrew.endsWith("ות")) patt["feminine -ות"].push(n);
    else if (pl.hebrew.endsWith("ים")) patt["masculine -ים"].push(n);
    else patt["irregular / other"].push(n);
  }
  const genderM = nouns.filter(n => n.gender === "m").length;
  const genderF = nouns.filter(n => n.gender === "f").length;

  const sample = (arr, n = 12) => shuffle([...arr]).slice(0, n).map(e => {
    const f = primaryForm(e); const pl = e.forms.find(x => x.slot === "plural");
    return `<tr><td>${esc(e.english)}</td><td class="heb hebrew">${esc(hebOf(f))}</td>
      <td class="heb hebrew">${pl ? esc(hebOf(pl)) : ""}</td>
      <td><span class="mini-speak" data-sid="${e.id}">🔊</span></td></tr>`;
  }).join("");

  app.innerHTML = `
    <h2>Patterns & structure</h2>
    <div class="card-panel" style="margin-bottom:16px">
      <h3>Gender at a glance</h3>
      <p>Most plurals ending in <b class="hebrew">ים-</b> are masculine; <b class="hebrew">ות-</b> feminine; <b class="hebrew">יים-</b> is the <i>dual</i> (pairs — eyes, hands, trousers). Singular nouns ending in <b class="hebrew">ה</b> or <b class="hebrew">ת</b> tend to be feminine, but there are exceptions.</p>
      <div class="row"><span class="pill m">${genderM} masculine</span><span class="pill f">${genderF} feminine</span><span class="pill">${nouns.length - genderM - genderF} unmarked</span></div>
    </div>

    <div class="card-panel" style="margin-bottom:16px">
      <h3>Noun plural patterns</h3>
      <div class="chipbox" id="pattTabs">${Object.keys(patt).map((k, i) => `<div class="chip ${i === 0 ? "on" : ""}" data-p="${esc(k)}">${esc(k)}<span class="cnt">${patt[k].length}</span></div>`).join("")}</div>
      <table class="list" id="pattTable" style="margin-top:12px"><thead><tr><th>English</th><th>Singular</th><th>Plural</th><th></th></tr></thead><tbody>${sample(patt[Object.keys(patt)[0]])}</tbody></table>
    </div>

    <div class="card-panel">
      <h3>Verbs by binyan (verb pattern)</h3>
      <div class="chipbox" id="binTabs">${Object.keys(byBinyan).sort((a, b) => byBinyan[b].length - byBinyan[a].length).map((k, i) => `<div class="chip ${i === 0 ? "on" : ""}" data-b="${esc(k)}">${esc(k)}<span class="cnt">${byBinyan[k].length}</span></div>`).join("")}</div>
      <table class="list" id="binTable" style="margin-top:12px"><thead><tr><th>English</th><th>Infinitive</th><th>he (m.s)</th><th></th></tr></thead><tbody></tbody></table>
    </div>`;

  const patObj = patt;
  const fillPatt = k => { document.querySelector("#pattTable tbody").innerHTML = sample(patObj[k]); bindSids(); };
  document.getElementById("pattTabs").onclick = e => {
    const c = e.target.closest("[data-p]"); if (!c) return;
    document.querySelectorAll("#pattTabs .chip").forEach(x => x.classList.toggle("on", x === c));
    fillPatt(c.dataset.p);
  };
  const binObj = byBinyan;
  const fillBin = k => {
    const rows = shuffle([...binObj[k]]).slice(0, 14).map(v => {
      const inf = v.forms.find(f => f.slot === "infinitive"); const ms = v.forms.find(f => f.slot === "ms");
      return `<tr><td>${esc(v.english.replace(/\s*\(.*\)/, ""))}</td><td class="heb hebrew">${inf ? esc(hebOf(inf)) : ""}</td><td class="heb hebrew">${ms ? esc(hebOf(ms)) : ""}</td><td><span class="mini-speak" data-sid="${v.id}">🔊</span></td></tr>`;
    }).join("");
    document.querySelector("#binTable tbody").innerHTML = rows; bindSids();
  };
  document.getElementById("binTabs").onclick = e => {
    const c = e.target.closest("[data-b]"); if (!c) return;
    document.querySelectorAll("#binTabs .chip").forEach(x => x.classList.toggle("on", x === c));
    fillBin(c.dataset.b);
  };
  function bindSids() {
    app.querySelectorAll("[data-sid]").forEach(el => el.onclick = () => { const e = ENTRIES.find(x => x.id === el.dataset.sid); if (e) speakForm(e); });
  }
  fillBin(Object.keys(byBinyan).sort((a, b) => byBinyan[b].length - byBinyan[a].length)[0]);
  bindSids();
}

// ================= IMPORT =================
function parseCSV(text) {
  // simple CSV/TSV parser with quoted-field support; auto-detect delimiter
  const delim = text.indexOf("\t") > -1 && (text.indexOf("\t") < (text.indexOf(",") >>> 0)) ? "\t" : ",";
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); if (row.some(x => x.trim())) rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); if (row.some(x => x.trim())) rows.push(row); }
  return { rows, delim };
}

let importPreview = null;
function renderImport() {
  const custom = loadCustom();
  app.innerHTML = `
    <h2>Import words</h2>
    <div class="card-panel" style="margin-bottom:16px">
      <p class="muted">Add vocabulary from any source that exports <b>CSV or TSV</b> — Google Sheets, Excel, Anki, Quizlet. Your imported words are stored locally in this browser and appear as a <b>“My Words”</b> unit you can study like any other.</p>
      <p class="muted" style="font-size:13px">Expected columns (a header row helps auto-mapping): <code>english, hebrew, translit, plural_hebrew, pos, gender, unit</code>. Only <b>english</b> and <b>hebrew</b> are required. Nikkud in the Hebrew column is preserved.</p>
      <div class="row">
        <input type="file" id="csvFile" accept=".csv,.tsv,.txt" />
        <span class="muted">or paste below</span>
      </div>
      <textarea id="csvPaste" placeholder="english,hebrew,translit,plural_hebrew,pos,gender&#10;Window,חלון,khalon,חלונות,noun,m" style="width:100%;height:90px;margin-top:10px;background:var(--panel2);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:10px;font-family:monospace"></textarea>
      <div class="row" style="margin-top:10px"><button class="btn" id="parseBtn">Preview</button></div>
    </div>
    <div id="importPreview"></div>
    <div class="card-panel">
      <h3>Your imported words (${custom.length})</h3>
      ${custom.length ? `<button class="btn bad" id="clearCustom">Clear all imported words</button>` : `<p class="muted">None yet.</p>`}
    </div>`;

  document.getElementById("csvFile").onchange = ev => {
    const file = ev.target.files[0]; if (!file) return;
    const r = new FileReader(); r.onload = () => { document.getElementById("csvPaste").value = r.result; doPreview(r.result); }; r.readAsText(file);
  };
  document.getElementById("parseBtn").onclick = () => doPreview(document.getElementById("csvPaste").value);
  const cc = document.getElementById("clearCustom"); if (cc) cc.onclick = () => { if (confirm("Remove all imported words?")) { saveCustom([]); rebuildEntries(); renderImport(); toast("Cleared"); } };
}

function doPreview(text) {
  text = (text || "").trim(); if (!text) return;
  const { rows } = parseCSV(text);
  if (!rows.length) return toast("Nothing to parse");
  // detect header
  const first = rows[0].map(x => x.trim().toLowerCase());
  const known = ["english", "hebrew", "translit", "transliteration", "plural_hebrew", "plural", "pos", "gender", "unit"];
  const hasHeader = first.some(h => known.includes(h));
  const header = hasHeader ? first : ["english", "hebrew", "translit", "plural_hebrew", "pos", "gender"];
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const col = name => header.findIndex(h => h === name || (name === "translit" && h === "transliteration") || (name === "plural_hebrew" && h === "plural"));
  const items = dataRows.map((r, i) => {
    const g = (r[col("gender")] || "").trim().toLowerCase()[0];
    const en = (r[col("english")] || "").trim(); const he = (r[col("hebrew")] || "").trim();
    if (!en || !he) return null;
    const forms = [{ slot: "singular", translit: (r[col("translit")] || "").trim(), hebrew: he, nikkud: NIKKUD_RE.test(he) ? he : null }];
    const pl = (r[col("plural_hebrew")] || "").trim();
    if (pl) forms.push({ slot: "plural", translit: "", hebrew: pl, nikkud: NIKKUD_RE.test(pl) ? pl : null });
    return {
      id: "imp-" + Date.now() + "-" + i, unit: 999, unitName: "My Words", category: "custom",
      pos: (r[col("pos")] || "noun").trim() || "noun", english: en,
      gender: g === "m" || g === "f" ? g : null, genderSource: g ? "import" : null, binyan: null, root: null,
      forms, source: "import",
    };
  }).filter(Boolean);
  importPreview = items;
  const box = document.getElementById("importPreview");
  box.innerHTML = `<div class="card-panel" style="margin-bottom:16px">
    <h3>Preview — ${items.length} words</h3>
    <table class="list"><thead><tr><th>English</th><th>Hebrew</th><th>Translit</th><th>Plural</th><th>POS</th><th>Gen</th></tr></thead>
    <tbody>${items.slice(0, 30).map(e => `<tr><td>${esc(e.english)}</td><td class="heb hebrew">${esc(e.forms[0].hebrew)}</td><td class="translit">${esc(e.forms[0].translit)}</td><td class="heb hebrew">${esc(e.forms[1]?.hebrew || "")}</td><td>${esc(e.pos)}</td><td>${esc(e.gender || "")}</td></tr>`).join("")}</tbody></table>
    <div class="row" style="margin-top:12px"><button class="btn primary" id="confirmImport">Add ${items.length} words</button></div>
  </div>`;
  document.getElementById("confirmImport").onclick = () => {
    const cur = loadCustom(); saveCustom(cur.concat(importPreview)); rebuildEntries();
    toast(`Added ${importPreview.length} words`); renderImport();
  };
}

// ================= SENTENCES (rule-based + verified AI) =================
const senti = {
  dir: S.get("sentDir", "mixed"),
  useAI: S.get("sentAI", false),
  deck: [], i: 0, revealed: false, loadingAI: false, aiError: "", showSettings: false, built: false,
  aiProbe: "idle",   // idle | pending | yes | no — is a local LLM reachable?
};
function probeAI() {
  senti.aiProbe = "pending";
  window.Sentences.probeOllama().then(ok => {
    senti.aiProbe = ok ? "yes" : "no";
    if (!ok) senti.useAI = false;
    if (view === "sentences") renderSentences();
  });
}

function sentScopeName() {
  const u = UNITS.find(x => x.index === currentUnit);
  return u ? `${String(currentUnit).padStart(2, "0")} · ${u.name}` : `unit ${currentUnit}`;
}
function pickDir() { return senti.dir === "mixed" ? (Math.random() < 0.5 ? "he2en" : "en2he") : senti.dir; }

function buildSentDeck() {
  const Sx = window.Sentences;
  const scope = Sx.scopeEntries(currentUnit);
  const rule = Sx.ruleBatch(scope, 14).map(s => ({ ...s, _dir: pickDir() }));
  senti.deck = rule; senti.i = 0; senti.revealed = false; senti.built = true; senti.aiError = "";
  if (senti.useAI) fetchAISentences();
}

function fetchAISentences() {
  const Sx = window.Sentences;
  // Ollama rejects file:// pages (null origin) before we even try — skip the doomed request
  // and show a friendly, actionable note instead of a network error.
  if (location.protocol === "file:") {
    senti.loadingAI = false;
    senti.aiError = "AI needs to run over http (Ollama won't accept a file:// page). Double-click serve.command in this folder — it opens the app at a localhost URL where AI works. Everything else works fine here.";
    if (view === "sentences") renderSentences();
    return;
  }
  senti.loadingAI = true; senti.aiError = "";
  const scope = Sx.scopeEntries(currentUnit);
  Sx.ollamaBatch(scope, 8).then(list => {
    senti.loadingAI = false;
    const add = list.map(s => ({ ...s, _dir: pickDir() }));
    // interleave AI after current position so they show up soon
    senti.deck = senti.deck.concat(add);
    if (view === "sentences") renderSentences();
    if (add.length) toast(`Added ${add.length} AI sentences (drafts)`);
    else toast("AI returned nothing in-scope this time");
  }).catch(err => {
    senti.loadingAI = false;
    senti.aiError = /Failed to fetch|NetworkError|load failed/i.test(err.message)
      ? "Couldn't reach Ollama at " + Sx.cfg().endpoint + ". Is it running? (`ollama serve`) — check the endpoint in AI settings."
      : err.message;
    if (view === "sentences") renderSentences();
  });
}

function sentWordBreakdown(s) {
  const Sx = window.Sentences;
  if (s.words && s.words.length) {
    return s.words.map(w => `<div class="bd"><span class="hebrew">${esc(toggles.nikkud ? w.nikkud : w.plain)}</span>${w.translit ? `<span class="translit">${esc(w.translit)}</span>` : ""}<span class="muted">${esc(w.en)}</span></div>`).join("");
  }
  // AI sentence: gloss each token from the scope dictionary
  const { dict } = Sx.buildDict(Sx.scopeEntries(currentUnit));
  const skel = t => t.replace(/[֑-ׇ]/g, "").replace(/["'.,!?]/g, "");
  return (s.he || "").split(/\s+/).map(tok => {
    const k = skel(tok); const info = dict.get(k) || (k[0] && dict.get(k.slice(1)));
    return `<div class="bd"><span class="hebrew">${esc(tok)}</span><span class="muted">${info ? esc(info.en) : ""}</span></div>`;
  }).join("");
}

function renderSentences() {
  if (!window.Sentences) { app.innerHTML = `<p class="muted">Loading…</p>`; return; }
  if (!senti.built) buildSentDeck();
  if (senti.aiProbe === "idle") probeAI();   // one-time check for a reachable local LLM

  const dirChips = [["he2en", "Hebrew → English"], ["en2he", "English → Hebrew"], ["mixed", "Mixed"]]
    .map(([v, l]) => `<div class="chip ${senti.dir === v ? "on" : ""}" data-dir="${v}">${l}</div>`).join("");
  const aiStatus = senti.loadingAI ? `<span class="muted">· generating…</span>`
    : senti.aiError ? `<span class="bad-text">· ${esc(senti.aiError)}</span>` : "";
  // AI controls only appear when a local LLM is actually reachable; otherwise a quiet note.
  const aiControls = senti.aiProbe === "yes"
    ? `<label class="chk"><input type="checkbox" id="aiToggle" ${senti.useAI ? "checked" : ""}> Include AI variety ${aiStatus}</label>
       <button class="btn ghost" id="ollSettings">⚙ AI settings</button>`
    : senti.aiProbe === "pending"
      ? `<span class="muted" style="font-size:13px">checking for local AI…</span>`
      : `<span class="muted" style="font-size:13px">AI sentences need a local LLM (Ollama) over http — not detected.</span>
         <button class="btn ghost" id="aiRecheck">Recheck</button>
         <button class="btn ghost" id="ollSettings">⚙ AI settings</button>`;

  const settingsPanel = senti.showSettings ? `
    <div class="card-panel" style="margin-bottom:14px">
      <h3>Local AI (Ollama)</h3>
      <div class="row">
        <label class="muted" style="min-width:70px">Endpoint</label>
        <input type="text" id="ollEndpoint" value="${esc((localStorage.getItem("ollamaEndpoint") || "http://localhost:11434"))}" style="min-width:260px">
        <label class="muted" style="min-width:50px">Model</label>
        <input type="text" id="ollModel" value="${esc(localStorage.getItem("ollamaModel") || "llama3:latest")}" style="min-width:150px">
        <button class="btn" id="ollTest">Test</button>
        <span id="ollTestOut" class="muted"></span>
      </div>
      <p class="muted" style="font-size:12px;margin-bottom:0">AI needs the app served over http. Easiest: double-click <code>serve.command</code> in this folder — it opens a <code>localhost</code> URL (Ollama allows localhost automatically). A plain <code>file://</code> page is blocked. AI sentences only use in-scope words, but <b>grammar is not guaranteed</b> — treat them as drafts.</p>
    </div>` : "";

  const s = senti.deck[senti.i];
  let stage;
  if (!senti.deck.length) {
    stage = `<div class="card-panel deck-done"><h2>Not enough words yet</h2>
      <p class="muted">This lesson scope doesn't yet have the mix needed (pronouns + verbs or adjectives). Mark a later lesson as current in the Lesson tab, then come back.</p></div>`;
  } else {
    const dir = s._dir;
    const heBlock = `<div class="big-heb hebrew">${esc(toggles.nikkud && s.heNikkud ? s.heNikkud : s.he)}</div>${toggles.translit && s.translit ? `<div class="translit">${esc(s.translit)}</div>` : ""}`;
    const enBlock = `<div class="big-en" style="font-size:30px">${esc(s.en)}</div>`;
    const prompt = dir === "he2en" ? heBlock : enBlock;
    const answer = dir === "he2en" ? enBlock : heBlock;
    const badge = s.source === "ai"
      ? `<span class="pill" style="color:var(--warn);border-color:var(--warn)">AI draft · check grammar</span>`
      : `<span class="pill" style="color:var(--good);border-color:var(--good)">rule-based · correct</span>`;
    stage = `
      <div class="stage">
        <div class="progressbar" style="max-width:640px"><i style="width:${Math.round(senti.i / senti.deck.length * 100)}%"></i></div>
        <div class="row" style="max-width:640px;width:100%">
          <span class="muted">${senti.i + 1} / ${senti.deck.length}</span><span class="spacer"></span>
          ${badge}<span class="pill">${esc(s.template)}</span>
        </div>
        <div class="flash" id="sflash">
          ${prompt}
          ${senti.revealed ? `<hr style="width:60%;border-color:var(--line)">${answer}
            <button class="speakbtn" id="sspeak">🔊</button>
            <div class="breakdown">${sentWordBreakdown(s)}</div>`
        : `<div class="type-prompt"><span class="hint">type your translation</span> ${dir === "he2en" ? typeGlyph(s.en, "en") : typeGlyph(stripN(s.he), "he")}</div>
           <div class="hint">or click / press space to reveal</div>`}
        </div>
        <div class="row" style="justify-content:center">
          ${senti.revealed
            ? `<button class="btn" id="sspeak2">🔊 Hear</button><button class="btn primary" id="snext">Next →</button>`
            : `<button class="btn" id="sreveal">Reveal</button>`}
        </div>
      </div>`;
  }

  app.innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <h2 style="margin:0">Sentences</h2>
      <span class="muted">Scope: words up to your current lesson — <b>${esc(sentScopeName())}</b> (change it in the Lesson tab).</span>
    </div>
    <div class="row" style="margin-bottom:12px">
      <div class="chipbox" id="dirBox">${dirChips}</div>
      <span class="spacer"></span>
      ${aiControls}
      <button class="btn" id="newBatch">↻ New batch</button>
    </div>
    ${settingsPanel}
    ${stage}`;

  document.getElementById("dirBox").onclick = e => {
    const c = e.target.closest("[data-dir]"); if (!c) return;
    senti.dir = c.dataset.dir; S.set("sentDir", senti.dir);
    senti.deck.forEach(x => x._dir = pickDir()); renderSentences();
  };
  const aiToggleEl = document.getElementById("aiToggle");
  if (aiToggleEl) aiToggleEl.onchange = e => {
    senti.useAI = e.target.checked; S.set("sentAI", senti.useAI);
    if (senti.useAI) fetchAISentences(); else renderSentences();
  };
  const ollSettingsEl = document.getElementById("ollSettings");
  if (ollSettingsEl) ollSettingsEl.onclick = () => { senti.showSettings = !senti.showSettings; renderSentences(); };
  const aiRecheckEl = document.getElementById("aiRecheck");
  if (aiRecheckEl) aiRecheckEl.onclick = () => { probeAI(); renderSentences(); };
  document.getElementById("newBatch").onclick = () => { buildSentDeck(); renderSentences(); };

  if (senti.showSettings) {
    document.getElementById("ollEndpoint").onchange = e => localStorage.setItem("ollamaEndpoint", e.target.value.trim());
    document.getElementById("ollModel").onchange = e => localStorage.setItem("ollamaModel", e.target.value.trim());
    document.getElementById("ollTest").onclick = () => {
      localStorage.setItem("ollamaEndpoint", document.getElementById("ollEndpoint").value.trim());
      localStorage.setItem("ollamaModel", document.getElementById("ollModel").value.trim());
      const out = document.getElementById("ollTestOut"); out.textContent = "testing…";
      window.Sentences.ollamaTest(4000).then(models => {
        out.innerHTML = `<span class="good-text">OK — models: ${esc(models.join(", "))}</span>`;
        senti.aiProbe = "yes";   // now reachable → surface the AI toggle
      }).catch(err => out.innerHTML = `<span class="bad-text">${esc(/Failed to fetch|load failed/i.test(err.message) ? "unreachable (set OLLAMA_ORIGINS='*')" : err.message)}</span>`);
    };
  }
  const reveal = () => { senti.revealed = true; renderSentences(); if (senti.deck[senti.i]) speak(senti.deck[senti.i].heNikkud || senti.deck[senti.i].he); };
  const next = () => { senti.i = (senti.i + 1) % senti.deck.length; senti.revealed = false; renderSentences(); };
  const sf = document.getElementById("sflash"); if (sf) sf.onclick = ev => { if (ev.target.closest(".type-trigger, .type-box")) return; if (!senti.revealed) reveal(); };
  const rv = document.getElementById("sreveal"); if (rv) rv.onclick = reveal;
  const nx = document.getElementById("snext"); if (nx) nx.onclick = next;
  for (const id of ["sspeak", "sspeak2"]) { const el = document.getElementById(id); if (el) el.onclick = ev => { ev.stopPropagation(); const c = senti.deck[senti.i]; speak(c.heNikkud || c.he); }; }
}

document.addEventListener("keydown", e => {
  if (view !== "sentences" || !senti.deck.length) return;
  if (e.target.tagName === "INPUT") return;
  if (e.key === " ") { e.preventDefault(); if (!senti.revealed) { senti.revealed = true; renderSentences(); const c = senti.deck[senti.i]; if (c) speak(c.heNikkud || c.he); } }
  else if (senti.revealed && (e.key === "n" || e.key === "N")) { senti.i = (senti.i + 1) % senti.deck.length; senti.revealed = false; renderSentences(); }
});

// ---------- render dispatch ----------
function render() {
  if (view === "lesson") renderLesson();
  else if (view === "sentences") renderSentences();
  else if (view === "grammar") renderGrammar();
  else if (view === "learn") renderLearnSetup();
  else if (view === "session") renderSession();
  else if (view === "browse") renderBrowse();
  else if (view === "patterns") renderPatterns();
  else if (view === "import") renderImport();
}
render();
