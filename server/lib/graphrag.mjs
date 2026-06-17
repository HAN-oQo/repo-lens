// GraphRAG: retrieve a small, relevant slice of the repo for a question, then ask
// an LLM. Retrieval = full-text hits + (when ready) graph-neighbor expansion.
import { search } from "./search.mjs";
import { readRepoFile } from "./repo.mjs";
import { getGraph } from "./graph.mjs";

const STOP = new Set("the a an of to in on for and or is are be this that with from how does do what where which when why function method class file code repo your you it its as at by".split(" "));

function terms(q) {
  return [...new Set(String(q).toLowerCase().match(/[a-z0-9_]{3,}/g) || [])]
    .filter((t) => !STOP.has(t))
    .sort((a, b) => b.length - a.length)
    .slice(0, 6);
}

const FILE_CAP = 6000; // chars per file in context
const TOTAL_CAP = 40000;

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

  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p).slice(0, 7);
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
async function callLLM(system, question, ko) {
  const key = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (key) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ASK_MODEL || "claude-sonnet-4-6",
        max_tokens: 1500,
        system,
        messages: [{ role: "user", content: question }],
      }),
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error.message || "anthropic error");
    return (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  }
  const url = (process.env.ASK_URL || "").trim();
  if (url) {
    const base = url.replace(/\/+$/, "");
    const askUrl = /\/ask$/.test(base) ? base : base + "/ask";
    const r1 = await fetch(askUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ASK_MODEL || "claude-sonnet-4-6", system, question, messages: [{ role: "user", content: question }], web: false, page_url: "/" }),
    }).then((r) => r.json());
    if (r1.answer != null) return r1.answer;
    if (!r1.id) throw new Error("askbot: no answer/id");
    const resBase = askUrl.replace(/\/ask$/, "/result");
    for (let i = 0; i < 180; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const j = await fetch(resBase + "?id=" + encodeURIComponent(r1.id)).then((r) => r.json());
      if (j.status === "done") return j.answer || "";
      if (j.status === "error") throw new Error(j.error || "askbot error");
    }
    throw new Error("askbot timeout");
  }
  throw new Error("No LLM configured (set ANTHROPIC_API_KEY or ASK_URL on the server).");
}

export async function ask(owner, repo, dir, question, { openFile, ko = false } = {}) {
  const { context, sources } = await buildContext(owner, repo, dir, question, openFile);
  const system =
    `You are a code assistant for the GitHub repo ${owner}/${repo}. Answer the user's question ` +
    `grounded ONLY in the repository excerpts below. Cite files by their repo-relative path in backticks. ` +
    `If the excerpts are insufficient, say what other file you'd need. Be concise. Answer in ${ko ? "Korean" : "English"}.\n\n` +
    `=== REPOSITORY EXCERPTS ===\n${context || "(no relevant files found)"}`;
  const answer = await callLLM(system, question, ko);
  return { answer, sources };
}
