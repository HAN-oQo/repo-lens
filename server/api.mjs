// /api/* router for the analysis backend. Mounted by server.mjs.
import { json, validName } from "./lib/util.mjs";
import {
  ensureClone, repoDir, listTree, findReadme, readRepoFile, readRepoBytes,
} from "./lib/repo.mjs";
import { search } from "./lib/search.mjs";
import { graphState, getGraph, requestGraph, buildFocusGraph, buildUsageFlowGraph } from "./lib/graph.mjs";
import { ask as graphRagAsk, listModels } from "./lib/graphrag.mjs";
import { AUTH_REQUIRED, validateUser, rateLimit } from "./lib/auth.mjs";
import { logActivity, recentActivity } from "./lib/activity.mjs";
import { extractUsage } from "./lib/usage.mjs";

const EXPENSIVE = new Set(["/api/repo", "/api/ask", "/api/graph"]);

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (d) => {
      if (b.length < 1_000_000) b += d;
    });
    req.on("end", () => resolve(b));
    req.on("error", () => resolve(""));
  });
}

function token(req) {
  return (req.headers["x-github-token"] || "").toString().trim();
}

/** repo=owner/repo → {owner, repo, dir} or null */
function resolveRepo(q) {
  const m = String(q || "").match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
  if (!m || !validName(m[1]) || !validName(m[2])) return null;
  return { owner: m[1], repo: m[2], dir: repoDir(m[1], m[2]) };
}

const IMG = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"]);
const IMG_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", ico: "image/x-icon", bmp: "image/bmp" };

export async function handleApi(req, res, url) {
  const p = url.pathname;
  try {
    // Login gate (public deployment): every API call needs a valid GitHub token.
    if (AUTH_REQUIRED) {
      const login = await validateUser(token(req));
      if (!login) return json(res, 401, { error: "Sign in with GitHub to use this instance." });
      if (EXPENSIVE.has(p) && !rateLimit(login, 40, 60000)) {
        return json(res, 429, { error: "Rate limit — slow down a moment." });
      }
    }

    // POST /api/repo {url, ref?}  → clone + tree + readme, kick off graph build
    if (p === "/api/repo" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const { parseRepo } = await import("./lib/repo.mjs");
      const parsed = parseRepo(body.url || "");
      if (!parsed) return json(res, 400, { error: "Could not parse repo (github.com owner/repo only)" });
      const cloned = await ensureClone({ owner: parsed.owner, repo: parsed.repo, ref: body.ref || parsed.branch, token: token(req) });
      const tree = await listTree(cloned.dir);
      const paths = tree.map((t) => t.path);
      logActivity(`scanned ${paths.length} files — ready to browse/search`, `${parsed.owner}/${parsed.repo}`);
      const readmePath = findReadme(paths);
      let readme = null;
      if (readmePath) readme = (await readRepoFile(cloned.dir, readmePath).catch(() => null))?.text ?? null;
      requestGraph(parsed.owner, parsed.repo, cloned.dir); // background build (no-op if graphify absent)
      return json(res, 200, {
        repo: { owner: parsed.owner, repo: parsed.repo, branch: cloned.branch, sha: cloned.sha },
        tree, readmePath, readme,
        graph: graphState(parsed.owner, parsed.repo),
      });
    }

    // GET /api/file?repo=o/r&path=...
    if (p === "/api/file" && req.method === "GET") {
      const r = resolveRepo(url.searchParams.get("repo"));
      const path = url.searchParams.get("path") || "";
      if (!r) return json(res, 400, { error: "bad repo" });
      const out = await readRepoFile(r.dir, path);
      return json(res, 200, out);
    }

    // GET /api/raw?repo=o/r&path=...  (images, served bytes)
    if (p === "/api/raw" && req.method === "GET") {
      const r = resolveRepo(url.searchParams.get("repo"));
      const path = url.searchParams.get("path") || "";
      if (!r) return json(res, 400, { error: "bad repo" });
      const ext = (path.split(".").pop() || "").toLowerCase();
      if (!IMG.has(ext)) return json(res, 400, { error: "not an image" });
      const bytes = await readRepoBytes(r.dir, path);
      res.writeHead(200, { "Content-Type": IMG_MIME[ext] || "application/octet-stream", "Cache-Control": "no-cache" });
      return res.end(bytes);
    }

    // GET /api/search?repo=o/r&q=&regex=&max=
    if (p === "/api/search" && req.method === "GET") {
      const r = resolveRepo(url.searchParams.get("repo"));
      if (!r) return json(res, 400, { error: "bad repo" });
      const q = url.searchParams.get("q") || "";
      const out = await search(r.dir, q, {
        regex: url.searchParams.get("regex") === "1",
        max: Math.min(500, Number(url.searchParams.get("max")) || 200),
      });
      if (q.trim().length >= 2) logActivity(`search "${q.slice(0, 40)}" — ${out.matches?.length ?? 0} hits via ${out.engine}`, `${r.owner}/${r.repo}`);
      return json(res, 200, out);
    }

    // GET /api/graph?repo=o/r
    if (p === "/api/graph" && req.method === "GET") {
      const r = resolveRepo(url.searchParams.get("repo"));
      if (!r) return json(res, 400, { error: "bad repo" });
      const g = await getGraph(r.owner, r.repo);
      return json(res, 200, g);
    }

    // POST /api/graph/focus {repo, files:["path1",…]}  → focused subgraph
    if (p === "/api/graph/focus" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const r = resolveRepo(body.repo || "");
      if (!r) return json(res, 400, { error: "bad repo" });
      const files = (Array.isArray(body.files) ? body.files : []).filter((f) => typeof f === "string").slice(0, 30);
      if (!files.length) return json(res, 400, { error: "no focus files" });
      const fg = buildFocusGraph(r.owner, r.repo, files);
      if (!fg) return json(res, 200, { status: "none", error: "graph not yet ready or no matching symbols" });
      return json(res, 200, { status: "ready", ...fg });
    }

    // POST /api/ask {repo, question, openFile?}  → GraphRAG answer + cites
    if (p === "/api/ask" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const r = resolveRepo(body.repo);
      if (!r) return json(res, 400, { error: "bad repo" });
      if (!body.question || String(body.question).trim().length < 2) return json(res, 400, { error: "empty question" });
      logActivity(`ask: "${String(body.question).slice(0, 60)}" — retrieving + LLM…`, `${r.owner}/${r.repo}`);
      const out = await graphRagAsk(r.owner, r.repo, r.dir, String(body.question), {
        openFile: typeof body.openFile === "string" ? body.openFile : undefined,
        ko: !!body.ko,
        model: typeof body.model === "string" && body.model ? body.model : undefined,
      });
      // If the graph is ready, extract a focused subgraph around the source files
      // so the frontend can switch from the overview to a query-relevant zoom.
      const srcFiles = (out.sources || []).map((s) => s.path).filter(Boolean);
      if (srcFiles.length) {
        const fg = buildFocusGraph(r.owner, r.repo, srcFiles);
        if (fg) out.focusGraph = fg;
      }
      return json(res, 200, out);
    }

    // GET /api/status?repo=o/r
    if (p === "/api/status" && req.method === "GET") {
      const r = resolveRepo(url.searchParams.get("repo"));
      if (!r) return json(res, 400, { error: "bad repo" });
      return json(res, 200, { graph: graphState(r.owner, r.repo) });
    }

    // GET /api/usage?repo=o/r  → README quickstart snippets + referenced symbols
    if (p === "/api/usage" && req.method === "GET") {
      const r = resolveRepo(url.searchParams.get("repo"));
      if (!r) return json(res, 400, { error: "bad repo" });
      const paths = (await listTree(r.dir).catch(() => [])).map((t) => t.path);
      const rp = findReadme(paths);
      const readme = rp ? (await readRepoFile(r.dir, rp).catch(() => null))?.text || "" : "";
      return json(res, 200, { repo: `${r.owner}/${r.repo}`, readmePath: rp, ...extractUsage(readme) });
    }

    // GET /api/usageflow?repo=o/r  → "what runs when you follow the README" subgraph
    if (p === "/api/usageflow" && req.method === "GET") {
      const r = resolveRepo(url.searchParams.get("repo"));
      if (!r) return json(res, 400, { error: "bad repo" });
      const paths = (await listTree(r.dir).catch(() => [])).map((t) => t.path);
      const rp = findReadme(paths);
      const readme = rp ? (await readRepoFile(r.dir, rp).catch(() => null))?.text || "" : "";
      const { symbols } = extractUsage(readme);
      const fg = buildUsageFlowGraph(r.owner, r.repo, symbols);
      if (!fg) return json(res, 200, { status: graphState(r.owner, r.repo).status === "ready" ? "none" : "building", symbols });
      return json(res, 200, { status: "ready", symbols, ...fg });
    }

    // GET /api/models  → model picker options (cloud defaults + live local list)
    if (p === "/api/models" && req.method === "GET") {
      return json(res, 200, await listModels());
    }

    // GET /api/activity?since=<id>&repo=o/r  → live backend activity log
    if (p === "/api/activity" && req.method === "GET") {
      const since = Number(url.searchParams.get("since")) || 0;
      const repoQ = url.searchParams.get("repo") || "";
      const scope = resolveRepo(repoQ) ? repoQ : "";
      return json(res, 200, recentActivity(since, scope));
    }

    return json(res, 404, { error: "no such api route" });
  } catch (e) {
    return json(res, 500, { error: String(e?.message || e).replace(/[A-Za-z0-9_-]{20,}/g, "***") });
  }
}
