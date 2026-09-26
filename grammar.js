/* Grammar tab — authored explanations of Hebrew roots & structure, with live examples
 * pulled from the vocabulary and tagged by whether you've reached that lesson yet.
 * Loaded after app.js; uses globals ENTRIES, currentUnit, primaryForm, esc, escAttr,
 * dispHeb, translitFromNikkud, stripN, speak, bindSay, toggles.
 */
"use strict";

const GRAMMAR_ROOTS = [
  { r: "כתב", mean: "writing" },
  { r: "אכל", mean: "eating" },
  { r: "ספר", mean: "counting · telling · books" },
  { r: "למד", mean: "learning · teaching" },
  { r: "גדל", mean: "bigness · growing" },
  { r: "שמר", mean: "guarding · keeping" },
  { r: "אהב", mean: "love" },
  { r: "ידע", mean: "knowing" },
];

const BINYANIM = [
  { key: "Qal", he: "פָּעַל", name: "Qal (Pa'al)", voice: "simple active",
    desc: "The basic, simple active verb — by far the most common. Plain actions: to write, eat, sit, go. This is what “(Qal)” next to a verb means." },
  { key: "Nifal", he: "נִפְעַל", name: "Nif'al", voice: "simple passive / reflexive",
    desc: "Usually the passive or reflexive counterpart of Qal: “was written”, “was eaten”. Typically picks up a נ prefix." },
  { key: "Piel", he: "פִּיעֵל", name: "Pi'el", voice: "intensive active",
    desc: "Active, often intensive or “make it happen”: speak, tell, tidy, repair. The middle root letter is doubled (a dagesh)." },
  { key: "Pual", he: "פֻּעַל", name: "Pu'al", voice: "intensive passive",
    desc: "The passive of Pi'el: “was told”, “was repaired”." },
  { key: "Hifil", he: "הִפְעִיל", name: "Hif'il", voice: "causative active",
    desc: "Causative — making someone/something do the action: seat, bring in, enlarge. Often a ה prefix and an added י." },
  { key: "Hufal", he: "הֻפְעַל", name: "Huf'al", voice: "causative passive",
    desc: "The passive of Hif'il: “was brought in”, “was enlarged”." },
  { key: "Hitpael", he: "הִתְפַּעֵל", name: "Hitpa'el", voice: "reflexive / reciprocal",
    desc: "Reflexive or reciprocal — doing something to or among oneself: get dressed, correspond. Starts with הִת." },
];

function gInScope(e) { return typeof e.unit === "number" && e.unit >= 1 && e.unit <= currentUnit; }
function gClean(en) { return (en || "").replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim(); }
function gScopeTag(e) {
  if (e.unit === 0 || e.unit === 999) return `<span class="scope-tag extra">bank</span>`;
  return gInScope(e)
    ? `<span class="scope-tag learned">✓ ${String(e.unit).padStart(2, "0")}</span>`
    : `<span class="scope-tag later">later · ${String(e.unit).padStart(2, "0")}</span>`;
}
function gChip(e) {
  const f = primaryForm(e); const nik = f.nikkud || f.hebrew;
  const tr = toggles.translit ? `<span class="translit">${esc(f.translit || translitFromNikkud(nik))}</span>` : "";
  return `<div class="ex-chip ${gInScope(e) ? "" : "dim"}">
    <span class="heb hebrew say" data-say="${escAttr(nik)}" title="Click to hear">${esc(dispHeb(nik))} <span class="mini-speak">🔊</span></span>
    ${tr}<span class="ex-en">${esc(gClean(e.english))}</span>${gScopeTag(e)}</div>`;
}

function subseqRoot(root, word) {
  let i = 0;
  for (const ch of word) { if (ch === root[i]) i++; if (i === root.length) return true; }
  return false;
}
function rootFamily(root) {
  const seen = new Set(); const out = [];
  for (const e of ENTRIES) {
    if (!["verb", "noun", "adjective"].includes(e.pos)) continue;
    if (/^[MF]\.[SP]/.test(e.english)) continue;
    const f = primaryForm(e); const sk = stripN(f.hebrew);
    if (!sk || /\s/.test(sk) || sk.length < 2 || sk.length > 6) continue;
    if (!subseqRoot(root, sk)) continue;
    if (seen.has(sk)) continue; seen.add(sk);
    out.push(e);
  }
  const hasNum = e => /\([0-9]/.test(e.english) ? 1 : 0;   // prefer non-inflected dictionary forms
  out.sort((a, b) => (gInScope(b) - gInScope(a)) || (hasNum(a) - hasNum(b)) || (stripN(primaryForm(a).hebrew).length - stripN(primaryForm(b).hebrew).length));
  return out.slice(0, 8);
}

function verbsByBinyan(key) {
  const out = ENTRIES.filter(e => e.pos === "verb" && e.binyan === key);
  out.sort((a, b) => gInScope(b) - gInScope(a));
  return out.slice(0, 10);
}

function nounsByPlural(kind) {
  const out = [];
  for (const e of ENTRIES) {
    if (e.pos !== "noun") continue;
    const pl = e.forms.find(f => f.slot === "plural"); if (!pl) continue;
    const h = pl.hebrew;
    const ok = kind === "m" ? (h.endsWith("ים") && !h.endsWith("יים"))
      : kind === "f" ? h.endsWith("ות")
        : h.endsWith("יים");
    if (ok) out.push(e);
  }
  out.sort((a, b) => gInScope(b) - gInScope(a));
  return out;
}

function nounDual(e) {
  const pl = e.forms.find(f => f.slot === "plural");
  return pl ? pl.hebrew.endsWith("יים") : false;
}

// irregular gender examples: overridden nouns whose ending would mislead
const IRREG_M = ["אבא", "לילה", "שולחן", "חלון", "מקום", "רחוב", "יין", "קול", "שם", "מים"];
const IRREG_F = ["שנה", "מילה", "ביצה", "עיר", "אבן", "כוס", "דרך", "יד", "עין"];
function findBySkel(sk) { return ENTRIES.find(e => stripN(e.forms[0].hebrew) === sk); }

function grammarSection(title, bodyHtml) {
  return `<section class="gram-sec"><h2>${esc(title)}</h2>${bodyHtml}</section>`;
}

function renderGrammar() {
  const rootCards = GRAMMAR_ROOTS.map(rt => {
    const fam = rootFamily(rt.r);
    if (!fam.length) return "";
    return `<div class="gram-card">
      <div class="gram-root"><span class="hebrew">${esc(rt.r.split("").join("־"))}</span></div>
      <div class="gram-mean">${esc(rt.mean)}</div>
      <div class="ex-wrap">${fam.map(gChip).join("")}</div>
    </div>`;
  }).join("");

  const binyanCards = BINYANIM.map(b => {
    const ex = verbsByBinyan(b.key);
    const exHtml = ex.length ? `<div class="ex-wrap">${ex.map(gChip).join("")}</div>`
      : `<div class="muted" style="font-size:13px">No verbs of this pattern appear in the course.</div>`;
    return `<div class="gram-card">
      <div class="gram-binyan"><span class="hebrew">${esc(b.he)}</span> <b>${esc(b.name)}</b> <span class="pill">${esc(b.voice)}</span></div>
      <p class="gram-text">${esc(b.desc)}</p>
      ${exHtml}
    </div>`;
  }).join("");

  const mNouns = nounsByPlural("m"), fNouns = nounsByPlural("f"), dNouns = nounsByPlural("d");
  const irregM = IRREG_M.map(findBySkel).filter(Boolean);
  const irregF = IRREG_F.map(findBySkel).filter(Boolean);

  const genderBody = `
    <p class="gram-text">Every Hebrew noun is masculine or feminine, and the ending usually tells you which — but there are important exceptions. Adjectives and verbs must <b>agree</b> with the noun's gender and number.</p>
    <div class="gram-grid">
      <div class="gram-card"><div class="gram-binyan"><b>Regular masculine</b> <span class="pill m">plural ־ִים</span></div>
        <p class="gram-text">Most masculine nouns add <b class="hebrew">ים־</b> in the plural.</p>
        <div class="ex-wrap">${mNouns.slice(0, 8).map(gChip).join("")}</div></div>
      <div class="gram-card"><div class="gram-binyan"><b>Regular feminine</b> <span class="pill f">plural ־וֹת</span></div>
        <p class="gram-text">Most feminine nouns add <b class="hebrew">ות־</b>. Singulars ending in <b class="hebrew">ה</b> or <b class="hebrew">ת</b> are usually feminine.</p>
        <div class="ex-wrap">${fNouns.slice(0, 8).map(gChip).join("")}</div></div>
      <div class="gram-card"><div class="gram-binyan"><b>The dual</b> <span class="pill">ending ־ַיִם</span></div>
        <p class="gram-text">A special “pair” ending, used for things that come in twos — eyes, hands, legs, and some time words.</p>
        <div class="ex-wrap">${dNouns.slice(0, 8).map(gChip).join("")}</div></div>
    </div>`;

  const irregBody = `
    <p class="gram-text">The ending doesn't always match the gender — these must simply be memorised. They're common words, so worth learning early.</p>
    <div class="gram-grid">
      <div class="gram-card"><div class="gram-binyan"><b>Masculine, but looks feminine</b></div>
        <p class="gram-text">Masculine nouns that take the <b class="hebrew">ות־</b> plural (or end in ה) — e.g. father, night, table.</p>
        <div class="ex-wrap">${irregM.map(gChip).join("")}</div></div>
      <div class="gram-card"><div class="gram-binyan"><b>Feminine, but looks masculine</b></div>
        <p class="gram-text">Feminine nouns with a bare ending or an <b class="hebrew">ים־</b> plural — e.g. year, word, city, hand.</p>
        <div class="ex-wrap">${irregF.map(gChip).join("")}</div></div>
    </div>
    <p class="gram-text"><b>Weak-root verbs</b> are the other big “irregular” family: when a root contains א/ה/ו/י/נ, those letters can drop out or change in some patterns (e.g. the root of <span class="hebrew">לָבוֹא</span> “to come”). Don't worry about the rules yet — just notice when a verb looks like it's “missing” a root letter.</p>`;

  const scoped = ENTRIES.filter(gInScope).length;
  app.innerHTML = `
    <div class="gram-wrap">
      <div class="row" style="margin-bottom:6px"><h1 style="margin:0;font-size:24px">Roots &amp; structure</h1>
        <span class="muted">Examples come from your vocabulary. <span class="scope-tag learned" style="position:static">✓ NN</span> = a lesson you've reached (up to ${String(currentUnit).padStart(2, "0")}); <span class="scope-tag later" style="position:static">later · NN</span> = coming up.</span></div>

      ${grammarSection("The big idea: roots + patterns", `
        <p class="gram-text">Hebrew words are built from a <b>root</b> (שׁוֹרֶשׁ, <i>shoresh</i>) — usually <b>three consonants</b> that carry a core meaning — poured into a <b>pattern</b> (a fixed template of vowels and prefixes). Change the pattern and you get a whole family of related words from one root.</p>
        <p class="gram-text">So “<b>Qal</b>” on a verb is <b>not the root</b> — it's the <b>binyan</b> (the verb pattern). The root of <span class="hebrew">לִכְתֹּב</span> (“to write”) is <b class="hebrew">כ־ת־ב</b> (k-t-v, “writing”); Qal is just the template it's sitting in. The same root in other patterns gives <span class="hebrew">מִכְתָּב</span> (a letter) and <span class="hebrew">כְּתוֹבֶת</span> (an address).</p>`)}

      ${grammarSection("Root families — one root, many words", `
        <p class="gram-text">Spot the shared consonants running through each family below. Learn the root and you can often guess the rest.</p>
        <div class="gram-grid">${rootCards}</div>`)}

      ${grammarSection("Binyanim — the seven verb patterns", `
        <p class="gram-text">Every Hebrew verb lives in one of seven <b>binyanim</b> (patterns). They mostly encode <i>voice</i>: active vs passive, simple vs intensive vs causative vs reflexive. This is the label you see beside each verb.</p>
        <div class="gram-grid">${binyanCards}</div>`)}

      ${grammarSection("Gender & number — the regular patterns", genderBody)}
      ${grammarSection("Irregular gender & weak roots", irregBody)}
    </div>`;
  bindSay(app);
}
