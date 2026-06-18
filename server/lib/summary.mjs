// One-line "role" summaries for files and directories, computed lazily via the
// configured LLM and cached to disk keyed by the repo's HEAD sha (so a new commit
// invalidates them). Bottom-up: a directory's summary is built from its immediate
// children (reusing cached child summaries when present). Rate-limited by a small
// concurrency cap + in-flight dedupe so repeated requests share one LLM call.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, run } from "./util.mjs";
import { readRepoFile, listTree } from "./repo.mjs";
import { callLLM } from "./graphrag.mjs";
import { logActivity } from "./activity.mjs";

const cacheFile = (owner, repo) => join(DATA_DIR, "cache", `${owner}_${repo}.summaries.json`);

function loadCache(owner, repo) {
  try {
    const f = cacheFile(owner, repo);
    if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  } catch {}
  return { sha: "", summaries: {} };
}
function saveCache(owner, repo, cache) {
  try {
    mkdirSync(join(DATA_DIR, "cache"), { recursive: true });
    writeFileSync(cacheFile(owner, repo), JSON.stringify(cache));
  } catch {}
}

export async function headSha(dir) {
  const r = await run("git", ["-C", dir, "rev-parse", "HEAD"], { timeout: 15000 });
  return r.code === 0 ? r.stdout.toString().trim() : "";
}

// first non-empty line, trimmed of leading list/quote markers, capped.
function oneLine(s) {
  const line = String(s || "").split("\n").map((x) => x.trim()).find(Boolean) || "";
  return line.replace(/^["'`*\-\d.)\s]+/, "").trim().slice(0, 200);
}

const FILE_CAP = 4000; // chars of file content fed to the LLM (keeps it fast/cheap)

// in-flight dedupe + tiny concurrency cap = the "rate-limited" part.
const inflight = new Map();
let active = 0;
const MAX_CONCURRENT = 2;
const queue = [];
function slot() {
  if (active < MAX_CONCURRENT) { active++; return Promise.resolve(); }
  return new Promise((r) => queue.push(r)).then(() => { active++; });
}
function release() {
  active--;
  const next = queue.shift();
  if (next) next();
}

/** Immediate children of a directory path, from the tracked tree. */
function childrenOf(paths, normDir) {
  const prefix = normDir ? normDir.replace(/\/+$/, "") + "/" : "";
  const files = new Set();
  const dirs = new Set();
  for (const p of paths) {
    if (prefix && !p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash === -1) files.add(p);
    else dirs.add(prefix + rest.slice(0, slash));
  }
  return { files: [...files], dirs: [...dirs] };
}

async function buildPrompt(owner, repo, dir, norm, cache) {
  const paths = (await listTree(dir).catch(() => [])).map((t) => t.path);
  const isFile = paths.includes(norm);
  if (isFile) {
    const f = await readRepoFile(dir, norm).catch(() => null);
    const body = f && !f.tooLarge ? (f.text || "").slice(0, FILE_CAP) : "";
    return {
      kind: "file",
      question:
        `In ONE concise sentence, describe the role of the file \`${norm}\` in ${owner}/${repo} ` +
        `(what it does / what it's for). No preamble, just the sentence.\n\n=== ${norm} ===\n${body || "(empty or binary)"}`,
    };
  }
  // directory (or repo root when norm === ""): bottom-up from immediate children
  const { files, dirs } = childrenOf(paths, norm);
  const childLines = [...dirs.map((d) => `${d}/`), ...files]
    .slice(0, 60)
    .map((c) => (cache.summaries[c] ? `- ${c} — ${cache.summaries[c]}` : `- ${c}`))
    .join("\n");
  return {
    kind: "dir",
    question:
      `In ONE concise sentence, describe the role of the directory \`${norm || "(repo root)"}\` in ${owner}/${repo}, ` +
      `based on its contents below. No preamble, just the sentence.\n\n=== contents of ${norm || "/"} ===\n${childLines || "(empty)"}`,
  };
}

/** Lazily compute (or return cached) a one-line role for a file/dir path. */
export async function summarize(owner, repo, dir, path, { model, sha } = {}) {
  const head = sha || (await headSha(dir));
  const cache = loadCache(owner, repo);
  if (cache.sha !== head) { cache.sha = head; cache.summaries = {}; }
  const norm = String(path || "").replace(/^\/+|\/+$/g, "");

  if (cache.summaries[norm]) return { summary: cache.summaries[norm], cached: true, sha: head };

  const key = `${owner}/${repo}@${head}:${norm}`;
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    await slot();
    try {
      const { kind, question } = await buildPrompt(owner, repo, dir, norm, cache);
      const system =
        "You write terse, factual one-line role descriptions for code in a repository. " +
        "Reply with a single sentence and nothing else.";
      const answer = await callLLM(system, question, false, model);
      const summary = oneLine(answer) || `${kind} in ${owner}/${repo}`;
      cache.summaries[norm] = summary;
      saveCache(owner, repo, cache);
      logActivity(`summary: ${norm || "/"} — "${summary.slice(0, 60)}"`, `${owner}/${repo}`);
      return { summary, cached: false, sha: head };
    } finally {
      release();
    }
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}
