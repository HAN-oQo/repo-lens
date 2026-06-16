// GitHub data access — 100% client-side.
//
// Strategy to stay under the unauthenticated REST limit (60 req/hr/IP):
//   - repo meta:      1 API call  (GET /repos/{o}/{r})
//   - file tree:      1 API call  (GET /repos/{o}/{r}/git/trees/{branch}?recursive=1)
//   - languages:      1 API call  (GET /repos/{o}/{r}/languages)
//   - file contents:  0 API calls (served from raw.githubusercontent.com CDN)
// An optional Personal Access Token (stored only in localStorage) raises the
// limit to 5000/hr and unlocks private repos (which use the contents API).

import { openDB, type IDBPDatabase } from "idb";
import type { RepoMeta, RepoRef, TreeEntry } from "./types";

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
export const GH_TOKEN_LS = "repolens-gh-token";
export const OAUTH_BASE_LS = "repolens-oauth-url";

// Default "Sign in with GitHub" worker base. Edit this (or set it in ⚙) to your
// deployed worker from workers/github-oauth.worker.js, e.g. https://repolens-auth.<you>.workers.dev
export const DEFAULT_OAUTH_BASE = "";

export function getToken(): string {
  try {
    return (localStorage.getItem(GH_TOKEN_LS) || "").trim();
  } catch {
    return "";
  }
}

export function getOAuthBase(): string {
  try {
    return (localStorage.getItem(OAUTH_BASE_LS) || DEFAULT_OAUTH_BASE).trim().replace(/\/+$/, "");
  } catch {
    return DEFAULT_OAUTH_BASE;
  }
}

/** Kick off the OAuth flow: navigate to the worker, which redirects to GitHub. */
export function startGitHubLogin(base: string) {
  const appUrl = window.location.href.split("#")[0];
  window.location.href = `${base.replace(/\/+$/, "")}/gh/login?redirect=${encodeURIComponent(appUrl)}`;
}

/** If we came back from OAuth with #gh_token=…, store it and clean the URL. */
export function consumeOAuthToken(): string | null {
  try {
    const m = window.location.hash.match(/[#&]gh_token=([^&]+)/);
    if (!m) return null;
    const token = decodeURIComponent(m[1]);
    localStorage.setItem(GH_TOKEN_LS, token);
    const clean = window.location.hash.replace(/[#&]gh_token=[^&]+/, "").replace(/^#$/, "");
    history.replaceState(null, "", window.location.pathname + window.location.search + (clean && clean !== "#" ? clean : ""));
    return token;
  } catch {
    return null;
  }
}

export function signOut() {
  try {
    localStorage.removeItem(GH_TOKEN_LS);
  } catch {}
}

function apiHeaders(token: string): HeadersInit {
  const h: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function api<T>(path: string, token: string): Promise<T> {
  const res = await fetch(API + path, { headers: apiHeaders(token) });
  if (!res.ok) {
    let msg = `GitHub API ${res.status}`;
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
      msg = "GitHub rate limit reached. Add a token in settings (⚙) to raise it to 5000/hr.";
    } else if (res.status === 404) {
      msg = "Repository, branch, or path not found (private repos need a token).";
    } else {
      try {
        const j = await res.json();
        if (j.message) msg = `GitHub: ${j.message}`;
      } catch { /* ignore */ }
    }
    throw new GitHubError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

/** Accepts: owner/repo, https://github.com/owner/repo, .../tree/<branch>[/path], git URLs. */
export function parseRepoUrl(input: string): { owner: string; repo: string; branch?: string } | null {
  const s = input.trim();
  if (!s) return null;

  // owner/repo shorthand
  const short = s.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (short && !s.includes("://") && !s.includes("github.com")) {
    return { owner: short[1], repo: short[2] };
  }

  let url: URL;
  try {
    url = new URL(s.startsWith("http") ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (!/github\.com$/i.test(url.hostname) && !/githubusercontent\.com$/i.test(url.hostname)) {
    // tolerate bare host typo but require github
    if (!url.hostname.includes("github")) return null;
  }
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, "");
  // .../tree/<branch>/<path...>
  if (parts[2] === "tree" && parts[3]) {
    return { owner, repo, branch: decodeURIComponent(parts[3]) };
  }
  return { owner, repo };
}

/** Validate a token and return the authenticated login (throws on bad token). */
export async function validateToken(token: string): Promise<string> {
  const res = await fetch(API + "/user", { headers: apiHeaders(token) });
  if (!res.ok) {
    throw new GitHubError(
      res.status,
      res.status === 401 ? "Invalid or expired token." : `Token check failed (GitHub ${res.status}).`
    );
  }
  const j = await res.json();
  return (j.login as string) || "?";
}

export async function fetchRepoMeta(owner: string, repo: string): Promise<RepoMeta> {
  const j = await api<Record<string, unknown>>(`/repos/${owner}/${repo}`, getToken());
  return {
    defaultBranch: (j.default_branch as string) || "main",
    description: (j.description as string) ?? null,
    language: (j.language as string) ?? null,
    stars: (j.stargazers_count as number) ?? 0,
    private: !!j.private,
  };
}

export interface TreeResult {
  entries: TreeEntry[];
  truncated: boolean;
  sha: string;
}

export async function fetchTree(owner: string, repo: string, branch: string): Promise<TreeResult> {
  const j = await api<{ sha: string; truncated: boolean; tree: TreeEntry[] }>(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    getToken()
  );
  return {
    sha: j.sha,
    truncated: !!j.truncated,
    entries: (j.tree || []).filter((e) => e.type === "blob" || e.type === "tree"),
  };
}

export async function fetchLanguages(owner: string, repo: string): Promise<Record<string, number>> {
  try {
    return await api<Record<string, number>>(`/repos/${owner}/${repo}/languages`, getToken());
  } catch {
    return {};
  }
}

// ---------------- file contents (cached) ----------------

let dbPromise: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB("repo-lens", 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains("files")) d.createObjectStore("files");
      },
    });
  }
  return dbPromise;
}

function cacheKey(r: RepoRef, path: string) {
  return `${r.owner}/${r.repo}@${r.branch}:${path}`;
}

export async function fetchFile(ref: RepoRef, path: string): Promise<string> {
  const key = cacheKey(ref, path);
  try {
    const cached = await (await db()).get("files", key);
    if (typeof cached === "string") return cached;
  } catch { /* cache best-effort */ }

  const token = getToken();
  let text: string;
  if (token) {
    // contents API works for private + public (base64), counts against the 5000/hr budget.
    const j = await api<{ content?: string; encoding?: string; sha?: string }>(
      `/repos/${ref.owner}/${ref.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref.branch)}`,
      token
    );
    if (j.content && j.encoding === "base64") {
      text = decodeBase64(j.content);
    } else if (j.sha) {
      // Files > 1 MB come back with empty content — fetch the blob by sha instead.
      const blob = await api<{ content?: string; encoding?: string }>(
        `/repos/${ref.owner}/${ref.repo}/git/blobs/${j.sha}`,
        token
      );
      text = blob.content && blob.encoding === "base64" ? decodeBase64(blob.content) : blob.content || "";
    } else {
      text = j.content || "";
    }
  } else {
    const res = await fetch(`${RAW}/${ref.owner}/${ref.repo}/${encodeURIComponent(ref.branch)}/${path.split("/").map(encodeURIComponent).join("/")}`);
    if (!res.ok) throw new GitHubError(res.status, `Could not load ${path} (${res.status})`);
    text = await res.text();
  }
  try {
    await (await db()).put("files", text, key);
  } catch { /* ignore */ }
  return text;
}

function decodeBase64(b64: string): string {
  const clean = b64.replace(/\n/g, "");
  const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

/** Find the most likely README path in a flat tree. */
export function findReadme(paths: string[]): string | null {
  const top = paths.filter((p) => !p.includes("/"));
  const exact = top.find((p) => /^readme(\.md|\.markdown|\.rst|\.txt)?$/i.test(p));
  if (exact) return exact;
  const any = paths.find((p) => /(^|\/)readme\.(md|markdown|rst|txt)$/i.test(p) && !p.includes("/"));
  return any || top.find((p) => /^readme/i.test(p)) || null;
}
