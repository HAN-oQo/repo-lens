// Session persistence (Goal 5): keep the viewed repo across a page reload.
// Pure, DOM-free serialize/parse so it's unit-testable; the page reads/writes the
// URL + localStorage around these.

import type { RepoRef, Tab } from "./types";

export const REPO_STATE_LS = "repolens-repo-state";
export const TABS_LS = "repolens-tabs"; // map: "owner/repo" → { tabs, active }

// Only persist tabs we can faithfully restore on reload: README, file tabs, and the
// seeded graph tabs (overview/quickstart). Query tabs (view:"query") hold transient
// Ask-result subgraphs that can't be rebuilt from storage, so they're dropped.
const restorable = (t: Tab) => t.kind === "readme" || t.kind === "file" || (t.kind === "graph" && t.view !== "query");

export function serializeTabs(tabs: Tab[], active: string): string {
  const keep = (tabs || []).filter(restorable).map((t) => ({ kind: t.kind, id: t.id, title: t.title, ...(t.view ? { view: t.view } : {}) }));
  return JSON.stringify({ tabs: keep, active });
}

export function parseTabs(s: string | null | undefined): { tabs: Tab[]; active: string } | null {
  if (!s) return null;
  try {
    const o = typeof s === "string" ? JSON.parse(s) : s;
    if (!o || !Array.isArray(o.tabs)) return null;
    const tabs: Tab[] = o.tabs
      .filter((t: any) => t && typeof t.id === "string" && (t.kind === "readme" || t.kind === "file" || t.kind === "graph"))
      .map((t: any) => ({ kind: t.kind, id: t.id, title: String(t.title || t.id), ...(t.view ? { view: t.view } : {}) }));
    return { tabs, active: typeof o.active === "string" ? o.active : tabs[0]?.id || "" };
  } catch {
    return null;
  }
}

/** RepoRef → query string "repo=owner/repo&ref=branch" (no leading ?). Empty when unusable. */
export function serializeRepoState(ref: RepoRef | null | undefined): string {
  if (!ref || !ref.owner || !ref.repo) return "";
  const p = new URLSearchParams();
  p.set("repo", `${ref.owner}/${ref.repo}`);
  if (ref.branch) p.set("ref", ref.branch);
  return p.toString();
}

/** Parse "repo=owner/repo&ref=branch" (leading ?/# tolerated) → RepoRef | null. */
export function parseRepoState(s: string | null | undefined): RepoRef | null {
  if (!s) return null;
  const p = new URLSearchParams(String(s).replace(/^[?#]/, ""));
  const repo = (p.get("repo") || "").trim();
  const m = repo.match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], branch: (p.get("ref") || "").trim() };
}

/** A loadRepo() input string that round-trips the branch (URL form when ref is set). */
export function repoStateToInput(ref: RepoRef): string {
  return ref.branch
    ? `https://github.com/${ref.owner}/${ref.repo}/tree/${ref.branch}`
    : `${ref.owner}/${ref.repo}`;
}
