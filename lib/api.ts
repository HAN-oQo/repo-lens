// Backend client. Active only when NEXT_PUBLIC_API_BASE is set (the CE node deploy).
// When unset, the app uses the v1 browser path (lib/github.ts) — GitHub Pages demo.
import { GH_TOKEN_LS } from "./github";
import type { RepoRef, TreeEntry } from "./types";

export const API_BASE_LS = "repolens-api-base";
// Build-time default (baked for the public demo via CI) with an optional
// per-browser override (point the app at your own node, e.g. http://localhost:8080).
function resolveBase(): string {
  let v = process.env.NEXT_PUBLIC_API_BASE || "";
  try {
    if (typeof window !== "undefined") v = (localStorage.getItem(API_BASE_LS) || v);
  } catch {}
  return v.replace(/\/+$/, "");
}
export const API_BASE = resolveBase();
export const hasBackend = !!API_BASE;

function token(): string {
  try {
    return (localStorage.getItem(GH_TOKEN_LS) || "").trim();
  } catch {
    return "";
  }
}
function headers(extra?: Record<string, string>): HeadersInit {
  const h: Record<string, string> = { ...(extra || {}) };
  const t = token();
  if (t) h["x-github-token"] = t;
  return h;
}
const rid = (r: RepoRef) => `${r.owner}/${r.repo}`;

export interface LoadResult {
  repo: { owner: string; repo: string; branch: string; sha: string };
  tree: TreeEntry[];
  readme: string | null;
  readmePath: string | null;
  graph: { status: string; reason?: string };
}

export async function apiLoadRepo(url: string, ref?: string): Promise<LoadResult> {
  const res = await fetch(`${API_BASE}/api/repo`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ url, ref }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `backend ${res.status}`);
  return data;
}

export async function apiFileText(ref: RepoRef, path: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/file?repo=${encodeURIComponent(rid(ref))}&path=${encodeURIComponent(path)}`, {
    headers: headers(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `backend ${res.status}`);
  if (data.tooLarge) return `// file too large to display (${data.size} bytes)`;
  return data.text || "";
}

export interface SearchHit { path: string; line: number; col: number; preview: string; }
export async function apiSearch(ref: RepoRef, q: string): Promise<{ matches: SearchHit[]; truncated: boolean }> {
  const res = await fetch(`${API_BASE}/api/search?repo=${encodeURIComponent(rid(ref))}&q=${encodeURIComponent(q)}`, {
    headers: headers(),
  });
  if (!res.ok) return { matches: [], truncated: false };
  return res.json();
}

export function apiRawUrl(ref: RepoRef, path: string): string {
  return `${API_BASE}/api/raw?repo=${encodeURIComponent(rid(ref))}&path=${encodeURIComponent(path)}`;
}

export async function apiGraph(ref: RepoRef): Promise<any> {
  const res = await fetch(`${API_BASE}/api/graph?repo=${encodeURIComponent(rid(ref))}`, { headers: headers() });
  return res.json();
}

export interface ActivityLine { id: number; t: number; scope: string; msg: string; }
export async function apiActivity(since = 0, ref?: RepoRef): Promise<{ lines: ActivityLine[]; lastId: number }> {
  const repoQ = ref ? `&repo=${encodeURIComponent(rid(ref))}` : "";
  try {
    const res = await fetch(`${API_BASE}/api/activity?since=${since}${repoQ}`, { headers: headers() });
    if (!res.ok) return { lines: [], lastId: since };
    return res.json();
  } catch {
    return { lines: [], lastId: since };
  }
}

export interface ModelOptions { cloud: string[]; local: string[]; def: string; anthropic: boolean; }
export async function apiModels(): Promise<ModelOptions> {
  try {
    const res = await fetch(`${API_BASE}/api/models`, { headers: headers() });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  } catch {
    return { cloud: [], local: [], def: "", anthropic: false };
  }
}

export async function apiAsk(
  ref: RepoRef,
  question: string,
  openFile?: string,
  ko?: boolean,
  model?: string
): Promise<{ answer: string; sources: { path: string }[] }> {
  const res = await fetch(`${API_BASE}/api/ask`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ repo: rid(ref), question, openFile, ko, model }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `backend ${res.status}`);
  return data;
}
