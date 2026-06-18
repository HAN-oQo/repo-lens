// Session persistence (Goal 5): keep the viewed repo across a page reload.
// Pure, DOM-free serialize/parse so it's unit-testable; the page reads/writes the
// URL + localStorage around these.

import type { RepoRef } from "./types";

export const REPO_STATE_LS = "repolens-repo-state";

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
