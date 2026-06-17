// Knowledge-graph state + background build orchestration (graphify, code-only).
import { graphifyAvailable, buildGraphJson, toGraphData } from "./graphify.mjs";

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
  if (s.status === "ready" && s.data) return { status: "ready", ...s.data };
  return { status: s.status, error: s.error };
}

/** Kick off a background build (idempotent per repo). No-op if graphify is absent. */
export async function requestGraph(owner, repo, dir) {
  const key = `${owner}/${repo}`;
  const cur = state.get(key);
  if (cur && (cur.status === "building" || cur.status === "ready")) return;

  if (available === null) available = await graphifyAvailable().catch(() => false);
  if (!available) {
    state.set(key, { status: "unavailable", error: "graphify not installed on the server" });
    return;
  }

  state.set(key, { status: "building" });
  const job = async () => {
    active++;
    try {
      const json = await buildGraphJson(dir);
      state.set(key, { status: "ready", data: toGraphData(json), builtAt: json.built_at_commit || null });
    } catch (e) {
      state.set(key, { status: "error", error: String(e?.message || e).slice(0, 300) });
    } finally {
      active--;
      const next = waiting.shift();
      if (next) next();
    }
  };
  if (active >= MAX_CONCURRENT) waiting.push(job);
  else job();
}
