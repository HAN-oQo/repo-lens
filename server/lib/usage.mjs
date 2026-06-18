// Extract the "how you actually use this" bits from a README: the quickstart code
// blocks + the symbols (functions / imported names) they reference. Feeds the
// usage-driven graph (U2+) so the first thing a user sees is the README's flow.

const USAGE_HEADING = /(usage|quick\s*start|getting\s*started|example|basic)/i;
const DOC_LANGS = /^(bash|sh|shell|console|text|txt|diff|ini|toml|yaml|yml|json|dockerfile|makefile)$/i;

// keywords / stdlib names we never want to treat as "the repo's symbols"
const STOP = new Set(
  ("if else for while return const let var function class new this true false null undefined void typeof " +
   "import from export default require def print console log async await yield try catch finally throw " +
   "map filter forEach reduce push pop slice split join keys values entries Promise JSON Object Array " +
   "String Number Boolean Math Date Set Map RegExp parseInt parseFloat range len str int float list dict " +
   "self super and or not in is None True False").split(/\s+/)
);

/** Pull referenced symbols (imports + called names) out of code snippets. */
export function referencedSymbols(code) {
  const out = new Set();
  const add = (n) => { n = (n || "").trim(); if (n && n.length > 1 && !STOP.has(n) && /^[A-Za-z_$][\w$]*$/.test(n)) out.add(n); };
  // JS default + namespace imports:  import X from '...'   /  import * as X from
  for (const m of code.matchAll(/import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from/g)) add(m[1]);
  // JS named imports:  import { a, b as c } from
  for (const m of code.matchAll(/import\s*\{([^}]+)\}/g))
    m[1].split(",").forEach((s) => add(s.split(/\s+as\s+/)[0]));
  // require:  const X = require('...')
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*require\(/g)) add(m[1]);
  // python:  from pkg import a, b   /   import pkg
  for (const m of code.matchAll(/from\s+[\w.]+\s+import\s+([A-Za-z_][\w,\s]*)/g))
    m[1].split(",").forEach((s) => add(s));
  // calls:  name( …
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) add(m[1]);
  return [...out].slice(0, 25);
}

/** Build 3–5 clickable example entry points from README usage symbols + graph
 *  hubs. Each: { label (chip text), question (sent to Ask), symbol? (to focus the
 *  graph on, for U5). */
export function suggestEntryPoints({ symbols = [], hubs = [] } = {}) {
  const seen = new Set();
  const specific = [];
  const add = (arr, label, question, symbol) => {
    const k = (symbol || label).toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    arr.push(symbol ? { label, question, symbol } : { label, question });
  };
  // README usage entry points → "trace this call" (the unique value — keep up front)
  for (const s of symbols.slice(0, 3)) {
    add(specific, `Trace \`${s}()\``, `Trace what happens when you call \`${s}\` — walk through the code path step by step.`, s);
  }
  // most-depended-on symbols (graph hubs)
  for (const hb of hubs.slice(0, 3)) {
    const name = String(hb?.id || "").replace(/\(\)$/, "");
    if (name) add(specific, `How does \`${name}\` work?`, `Explain \`${name}\`: what it does and what depends on it.`, name);
  }
  // generic flows; "Repo overview" is always reserved a slot, the rest backfill.
  const generic = [];
  add(generic, "Repo overview", "Give a high-level overview of this repo: its purpose, main components, and how they connect.");
  add(generic, "Main flow", "Based on the imports and call graph, what is the main execution flow when this project runs?");
  add(generic, "Key files", "Which files are the most important to read first, and why?");

  const out = specific.slice(0, 4);
  out.push(generic[0]); // overview always offered
  for (let i = 1; i < generic.length && out.length < 3; i++) out.push(generic[i]); // backfill if sparse
  return out.slice(0, 5);
}

/** Parse README → { snippets:[{lang,code,heading}], symbols:[…] }. */
export function extractUsage(readme) {
  const lines = String(readme || "").split(/\r?\n/);
  const blocks = [];
  let heading = "";
  let inFence = false, lang = "", buf = [];
  for (const ln of lines) {
    const f = ln.match(/^\s*```(\w*)/);
    if (f) {
      if (inFence) { blocks.push({ lang, code: buf.join("\n"), heading }); inFence = false; buf = []; }
      else { inFence = true; lang = (f[1] || "").toLowerCase(); buf = []; }
      continue;
    }
    if (inFence) { buf.push(ln); continue; }
    const h = ln.match(/^#{1,6}\s+(.*)/);
    if (h) heading = h[1].trim();
  }
  // prefer code under a usage-ish heading; fall back to all code blocks. Prefer
  // real code over shell/doc fences for symbol extraction.
  const nonDoc = (b) => !DOC_LANGS.test(b.lang);
  const underUsage = blocks.filter((b) => USAGE_HEADING.test(b.heading) && b.code.trim());
  const pool = (underUsage.length ? underUsage : blocks).filter((b) => b.code.trim());
  const codePool = pool.filter(nonDoc);
  const chosen = (codePool.length ? codePool : pool).slice(0, 6);
  const symbols = referencedSymbols(chosen.filter(nonDoc).map((b) => b.code).join("\n") || chosen.map((b) => b.code).join("\n"));
  return {
    snippets: chosen.map((b) => ({ lang: b.lang, heading: b.heading, code: b.code.slice(0, 1500) })),
    symbols,
  };
}
