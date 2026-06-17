// Repository acquisition: shallow clone (cached), tree, file reads — all local.
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR, ensureDir, gitEnv, run, validName, hostAllowed, containedPath } from "./util.mjs";

const NAME = /^[A-Za-z0-9._-]+$/;

/** Accepts owner/repo, https://github.com/owner/repo[.git][/tree/branch]. github.com only. */
export function parseRepo(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  const short = s.match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/);
  if (short && !s.includes("://") && !s.includes("github.com")) {
    return { owner: short[1], repo: short[2] };
  }
  let url;
  try {
    url = new URL(s.startsWith("http") ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (!hostAllowed(url.hostname)) return null;
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, "");
  if (!validName(owner) || !validName(repo)) return null;
  if (parts[2] === "tree" && parts[3]) return { owner, repo, branch: decodeURIComponent(parts[3]) };
  return { owner, repo };
}

export function repoDir(owner, repo) {
  return join(DATA_DIR, "repos", owner, repo);
}

/** Clone (if absent) or fast-forward an existing clone. Returns {dir, branch, sha}. */
export async function ensureClone({ owner, repo, ref, token }) {
  if (!validName(owner) || !validName(repo)) throw new Error("invalid repo name");
  await ensureDir(join(DATA_DIR, "repos", owner));
  const dir = repoDir(owner, repo);
  const env = gitEnv(token);
  const url = `https://github.com/${owner}/${repo}.git`;

  const existing = await stat(join(dir, ".git")).then(() => true).catch(() => false);
  if (!existing) {
    const args = ["clone", "--depth", "1", "--single-branch"];
    if (ref) args.push("--branch", ref);
    args.push(url, dir);
    const r = await run("git", args, { env, timeout: 300000 });
    if (r.code !== 0) throw new Error("clone failed: " + sanitize(r.stderr));
  } else {
    // update to latest of the requested (or current) branch
    const branchNow = await currentBranch(dir, env);
    const target = ref || branchNow || "HEAD";
    await run("git", ["-C", dir, "fetch", "--depth", "1", "origin", target], { env, timeout: 180000 });
    await run("git", ["-C", dir, "reset", "--hard", "FETCH_HEAD"], { env, timeout: 60000 });
  }
  const branch = ref || (await currentBranch(dir, env)) || "HEAD";
  const sha = (await run("git", ["-C", dir, "rev-parse", "HEAD"], { env })).stdout.toString().trim();
  return { dir, branch, sha };
}

async function currentBranch(dir, env) {
  const r = await run("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], { env });
  const b = r.stdout.toString().trim();
  return b && b !== "HEAD" ? b : "";
}

/** Tracked files → flat list of {path, type:"blob", size}. Dirs are derived client-side. */
export async function listTree(dir) {
  const r = await run("git", ["-C", dir, "ls-files", "-z"], { timeout: 60000 });
  const paths = r.stdout.toString("utf8").split("\0").filter(Boolean);
  return paths.map((p) => ({ path: p, type: "blob" }));
}

export function findReadme(paths) {
  const top = paths.filter((p) => !p.includes("/"));
  return (
    top.find((p) => /^readme(\.md|\.markdown|\.rst|\.txt)?$/i.test(p)) ||
    top.find((p) => /^readme/i.test(p)) ||
    null
  );
}

const MAX_FILE = 2 * 1024 * 1024; // 2 MB text cap
export async function readRepoFile(dir, rel) {
  const full = containedPath(dir, rel);
  if (!full) throw new Error("path escapes repo");
  const st = await stat(full);
  if (!st.isFile()) throw new Error("not a file");
  if (st.size > MAX_FILE) return { tooLarge: true, size: st.size, text: "" };
  const buf = await readFile(full);
  return { tooLarge: false, size: st.size, text: buf.toString("utf8") };
}

/** Read raw bytes (for images), with a hard cap. */
export async function readRepoBytes(dir, rel, cap = 8 * 1024 * 1024) {
  const full = containedPath(dir, rel);
  if (!full) throw new Error("path escapes repo");
  const st = await stat(full);
  if (!st.isFile() || st.size > cap) throw new Error("not servable");
  return readFile(full);
}

// strip anything token-shaped from error text before it leaves the process
function sanitize(s) {
  return String(s || "").replace(/[A-Za-z0-9_-]{20,}/g, "***").slice(0, 500);
}
