// GraphRAG: retrieve a small, relevant slice of the repo for a question, then ask
// an LLM. Retrieval = full-text hits + (when ready) graph-neighbor expansion.
import { readFileSync, existsSync } from "node:fs";
import { search } from "./search.mjs";
import { readRepoFile } from "./repo.mjs";
import { getGraph } from "./graph.mjs";
import { logActivity } from "./activity.mjs";

// askbot is token-gated. On the CE node, reuse the SAME token file the bot/blog
// use (zero manual entry) — ASK_TOKEN env wins, else the first existing token
// file. Cached after first resolve.
let _askTok;
function askToken() {
  if (_askTok !== undefined) return _askTok;
  let t = (process.env.ASK_TOKEN || "").trim();
  if (!t) {
    const files = [process.env.ASK_TOKEN_FILE, "/srv/askbot/askbot.token", "/srv/ce-blog/askbot.token"].filter(Boolean);
    for (const f of files) {
      try { if (existsSync(f)) { t = readFileSync(f, "utf8").trim(); if (t) break; } } catch {}
    }
  }
  _askTok = t;
  return t;
}
// CORS-allowed origin the bot expects (preflight allows it). Configurable.
function askOrigin() {
  return (process.env.ASK_ORIGIN || (process.env.ALLOWED_REDIRECTS || "").split(",")[0] || "https://han-oqo.github.io").trim();
}
function askHeaders() {
  const h = { "content-type": "application/json", origin: askOrigin() };
  const t = askToken();
  if (t) h["x-access-token"] = t;
  return h;
}
function askBase() {
  const url = (process.env.ASK_URL || "").trim().replace(/\/+$/, "");
  return url ? url.replace(/\/ask$/, "") : "";
}

/** Models for the picker: Claude cloud defaults + live local list from the bot. */
export async function listModels() {
  const cloud = ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"];
  let local = ["claude-moreh-Qwen3.6-27B", "claude-moreh-gemma-4-31B-it", "claude-moreh-DeepSeek-V4-Flash"];
  const base = askBase();
  if (base) {
    try {
      const d = await fetch(base + "/models", { headers: askHeaders() }).then((r) => r.json());
      if (d?.models?.length) local = d.models.map((m) => (typeof m === "string" ? m : m.id)).filter(Boolean);
    } catch {}
  }
  const def = (process.env.ASK_MODEL || "").trim() || local[0] || cloud[1];
  return { cloud, local, def, anthropic: !!(process.env.ANTHROPIC_API_KEY || "").trim() };
}

const STOP = new Set("the a an of to in on for and or is are be this that with from how does do what where which when why function method class file code repo your you it its as at by".split(" "));

function terms(q) {
  return [...new Set(String(q).toLowerCase().match(/[a-z0-9_]{3,}/g) || [])]
    .filter((t) => !STOP.has(t))
    .sort((a, b) => b.length - a.length)
    .slice(0, 6);
}

const FILE_CAP = 6000; // chars per file in context
const TOTAL_CAP = 30000; // total context budget (keeps Ask fast + within model limits)
const MAX_FILES = 6; // top-N most relevant files

/** Pick the most relevant files for the question. */
async function relevantFiles(owner, repo, dir, question, openFile) {
  const counts = new Map();
  const bump = (p, n = 1) => counts.set(p, (counts.get(p) || 0) + n);

  // 1) full-text hits per term
  for (const t of terms(question)) {
    const r = await search(dir, t, { max: 40 });
    for (const m of r.matches) bump(m.path, 1);
  }
  // 2) graph-neighbor expansion (if the symbol graph is ready)
  const g = await getGraph(owner, repo).catch(() => ({ status: "none" }));
  if (g.status === "ready" && g.nodes) {
    const ts = terms(question);
    const seeds = g.nodes.filter((n) => ts.some((t) => (n.name || "").toLowerCase().includes(t)));
    const seedIds = new Set(seeds.map((n) => n.id));
    for (const n of seeds) if (n.sourceFile) bump(n.sourceFile, 3);
    for (const l of g.links) {
      if (seedIds.has(l.source) || seedIds.has(l.target)) {
        const other = seedIds.has(l.source) ? l.target : l.source;
        const node = g.nodes.find((n) => n.id === other);
        if (node?.sourceFile) bump(node.sourceFile, 1);
      }
    }
  }
  if (openFile) bump(openFile, 5);

  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p).slice(0, MAX_FILES);
}

/** Retrieval only (no LLM) + how long it took — used by ask() and by tests. */
export async function retrieveContext(owner, repo, dir, question, openFile) {
  const t0 = Date.now();
  const r = await buildContext(owner, repo, dir, question, openFile);
  return { ...r, ms: Date.now() - t0 };
}

export async function buildContext(owner, repo, dir, question, openFile) {
  const files = await relevantFiles(owner, repo, dir, question, openFile);
  const blocks = [];
  const sources = [];
  let total = 0;
  for (const path of files) {
    if (total > TOTAL_CAP) break;
    const f = await readRepoFile(dir, path).catch(() => null);
    if (!f || f.tooLarge || !f.text) continue;
    const body = f.text.length > FILE_CAP ? f.text.slice(0, FILE_CAP) + "\n…(truncated)" : f.text;
    blocks.push(`=== ${path} ===\n${body}`);
    sources.push({ path });
    total += body.length;
  }
  return { context: blocks.join("\n\n"), sources, files };
}

/** Call the configured LLM. Anthropic if ANTHROPIC_API_KEY, else an askbot-style URL. */
export async function callLLM(system, question, ko, model) {
  const key = (process.env.ANTHROPIC_API_KEY || "").trim();
  // A claude-moreh-* model only exists on the local gateway → must go via askbot,
  // never the Anthropic API. So only use the direct Anthropic path for cloud models.
  const isLocal = /^claude-moreh-/.test(model || "");
  if (key && !isLocal) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: model || process.env.ASK_MODEL || "claude-sonnet-4-6",
        max_tokens: 1500,
        system,
        messages: [{ role: "user", content: question }],
      }),
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error.message || "anthropic error");
    return (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  }
  const base = askBase();
  if (base) {
    const askUrl = base + "/ask";
    const headers = askHeaders(); // content-type + origin + x-access-token (auto from env/file)
    const r1 = await fetch(askUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: model || process.env.ASK_MODEL || "claude-moreh-Qwen3.6-27B", system, question, messages: [{ role: "user", content: question }], web: false, page_url: "/" }),
    }).then((r) => r.json());
    if (r1.error) throw new Error("askbot: " + (r1.error.message || r1.error));
    if (r1.answer != null) return r1.answer;
    if (!r1.id) throw new Error("askbot: no answer/id");
    const resBase = base + "/result";
    for (let i = 0; i < 180; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const j = await fetch(resBase + "?id=" + encodeURIComponent(r1.id), { headers }).then((r) => r.json());
      if (j.status === "done") return j.answer || "";
      if (j.status === "error") throw new Error(j.error || "askbot error");
    }
    throw new Error("askbot timeout");
  }
  throw new Error("No LLM configured (set ANTHROPIC_API_KEY or ASK_URL on the server).");
}

export async function ask(owner, repo, dir, question, { openFile, ko = false, model } = {}) {
  const tR = Date.now();
  const { context, sources } = await buildContext(owner, repo, dir, question, openFile);
  const retrievalMs = Date.now() - tR;
  const system =
    `You are a code assistant for the GitHub repo ${owner}/${repo}. Answer the user's question ` +
    `grounded ONLY in the repository excerpts below. Cite files by their repo-relative path in backticks. ` +
    `If the excerpts are insufficient, say what other file you'd need. Be concise. Answer in ${ko ? "Korean" : "English"}.\n\n` +
    `=== REPOSITORY EXCERPTS ===\n${context || "(no relevant files found)"}`;
  const tL = Date.now();
  const answer = await callLLM(system, question, ko, model);
  const llmMs = Date.now() - tL;
  logActivity(`ask: retrieved ${sources.length} files / ${context.length} chars in ${retrievalMs}ms · LLM ${llmMs}ms`, `${owner}/${repo}`);
  return { answer, sources, timing: { retrievalMs, llmMs, contextChars: context.length } };
}
