// Knowledge-graph state + background build orchestration (graphify, code-only).
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { graphifyAvailable, buildGraphJson, toGraphData, capGraph, extractSubgraph, extractSubgraphBySymbols } from "./graphify.mjs";
import { logActivity } from "./activity.mjs";
import { run } from "./util.mjs";

const MAX_GRAPH_NODES = Number(process.env.GRAPH_MAX_NODES || 600);

// graphify writes graph.json into the clone (which persists on disk across server
// restarts). We stamp the HEAD sha it was built at in a sidecar, so on the next
// run we can reuse it instead of re-running graphify (minutes on a big repo).
const SHA_SIDECAR = (dir) => join(dir, "graphify-out", ".repolens-sha");
const GRAPH_JSON = (dir) => join(dir, "graphify-out", "graph.json");

async function headSha(dir) {
  const r = await run("git", ["-C", dir, "rev-parse", "HEAD"], { timeout: 15000 });
  return r.code === 0 ? r.stdout.toString().trim() : "";
}

/** If a fresh-enough graph.json is already on disk for this sha, return its parsed
 *  JSON so we can skip graphify entirely. */
function diskGraphForSha(dir, sha) {
  if (!sha || !existsSync(GRAPH_JSON(dir)) || !existsSync(SHA_SIDECAR(dir))) return null;
  try {
    if (readFileSync(SHA_SIDECAR(dir), "utf8").trim() !== sha) return null;
    return JSON.parse(readFileSync(GRAPH_JSON(dir), "utf8"));
  } catch {
    return null;
  }
}

const state = new Map(); // "owner/repo" -> { status, data?, error?, builtAt? }
let available = null; // cached graphifyAvailable()
let active = 0;
const MAX_CONCURRENT = 2;
const waiting = [];

export function graphState(owner, repo) {
  const s = state.get(`${owner}/${repo}`);
  if (!s) return { status: "none" };
  return { status: s.status, error: s.error, communities: s.data?.communities, nodes: s.data?.nodes?.length };
}

export async function getGraph(owner, repo) {
  const s = state.get(`${owner}/${repo}`);
  if (!s) return { status: "none" };
  // Send only a renderable top-N overview; the full graph stays cached (s.data)
  // for query-focused subgraphs. 84k-node repos kill the browser otherwise.
  if (s.status === "ready" && s.data) return { status: "ready", ...capGraph(s.data, MAX_GRAPH_NODES) };
  return { status: s.status, error: s.error };
}

/** Return the uncapped full graph from cache (for subgraph extraction). */
export function getFullGraph(owner, repo) {
  const s = state.get(`${owner}/${repo}`);
  if (s?.status === "ready" && s.data) return s.data;
  return null;
}

/** Extract a focused subgraph around filePaths from the full cached graph. */
export function buildFocusGraph(owner, repo, filePaths) {
  const full = getFullGraph(owner, repo);
  if (!full || !filePaths.length) return null;
  return extractSubgraph(full, filePaths, 1); // 1-hop neighbors
}

/** The "what runs when you follow the README" subgraph, seeded by usage symbols. */
export function buildUsageFlowGraph(owner, repo, symbols) {
  const full = getFullGraph(owner, repo);
  if (!full || !symbols || !symbols.length) return null;
  return extractSubgraphBySymbols(full, symbols, 1); // entry points + their callees
}

/** Kick off a background build (idempotent per repo). No-op if graphify is absent. */
export async function requestGraph(owner, repo, dir) {
  const key = `${owner}/${repo}`;
  const cur = state.get(key);
  if (cur && (cur.status === "building" || cur.status === "ready")) return;

  if (available === null) available = await graphifyAvailable().catch(() => false);
  if (!available) {
    state.set(key, { status: "unavailable", error: "graphify not installed on the server" });
    logActivity("graph: graphify not installed — skipping symbol graph", key);
    return;
  }

  state.set(key, { status: "building" });
  const job = async () => {
    active++;
    try {
      // Fast path: reuse the on-disk graph if the repo hasn't changed (skips the
      // multi-minute `graphify update` after a restart / repeat load).
      const sha = await headSha(dir);
      const cached = diskGraphForSha(dir, sha);
      if (cached) {
        logActivity("graph: reusing cached build (sha unchanged) — skipping graphify", key);
        const data = toGraphData(cached);
        state.set(key, { status: "ready", data, builtAt: sha });
        logActivity(`graph: ready (cached) — ${data.nodes?.length ?? 0} nodes / ${data.links?.length ?? 0} edges`, key);
        return;
      }
      logActivity("graph: building symbol graph (graphify update)…", key);
      const json = await buildGraphJson(dir, (line) => {
        if (line.length >= 2) logActivity("graphify: " + line.slice(0, 140), key);
      });
      const data = toGraphData(json);
      state.set(key, { status: "ready", data, builtAt: sha || json.built_at_commit || null });
      // stamp the sha so the next run can reuse this build
      try { if (sha) writeFileSync(SHA_SIDECAR(dir), sha); } catch {}
      logActivity(`graph: ready — ${data.nodes?.length ?? 0} nodes / ${data.links?.length ?? 0} edges / ${data.communities ?? 0} communities`, key);
    } catch (e) {
      state.set(key, { status: "error", error: String(e?.message || e).slice(0, 300) });
      logActivity("graph: build failed — " + String(e?.message || e).slice(0, 120), key);
    } finally {
      active--;
      const next = waiting.shift();
      if (next) next();
    }
  };
  if (active >= MAX_CONCURRENT) { logActivity("graph: queued (build slots busy)…", key); waiting.push(job); }
  else job();
}
