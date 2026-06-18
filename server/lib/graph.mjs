// Knowledge-graph state + background build orchestration (graphify, code-only).
import { graphifyAvailable, buildGraphJson, toGraphData, capGraph, extractSubgraph } from "./graphify.mjs";
import { logActivity } from "./activity.mjs";

const MAX_GRAPH_NODES = Number(process.env.GRAPH_MAX_NODES || 600);

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
      logActivity("graph: building symbol graph (graphify update)…", key);
      const json = await buildGraphJson(dir, (line) => {
        if (line.length >= 2) logActivity("graphify: " + line.slice(0, 140), key);
      });
      const data = toGraphData(json);
      state.set(key, { status: "ready", data, builtAt: json.built_at_commit || null });
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
