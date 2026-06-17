// Full-text code search over a clone. Prefers ripgrep (fast, JSON); falls back to
// `git grep` when no `rg` binary is on PATH (always available since we have git).
import { run } from "./util.mjs";

export async function search(dir, query, { regex = false, max = 200, ignoreCase = true } = {}) {
  const q = String(query || "");
  if (q.length < 2) return { matches: [], truncated: false };

  const rgArgs = ["--json", "--max-count", "50", "--max-columns", "300", "--max-filesize", "2M"];
  if (ignoreCase) rgArgs.push("-i");
  if (!regex) rgArgs.push("-F");
  rgArgs.push("--", q, ".");

  let r = await run("rg", rgArgs, { cwd: dir, timeout: 20000, maxBuffer: 16 * 1024 * 1024 });

  if (r.code === -1) {
    // no ripgrep binary → git grep fallback
    return gitGrep(dir, q, { regex, max, ignoreCase });
  }
  if (r.code === 2) return { matches: [], truncated: false, error: "search failed", engine: "rg" };

  const matches = [];
  let truncated = false;
  for (const line of r.stdout.toString("utf8").split("\n")) {
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== "match") continue;
    const d = obj.data;
    const path = d.path?.text;
    if (!path) continue;
    const preview = (d.lines?.text || "").replace(/\n$/, "").slice(0, 300);
    const sub = d.submatches?.[0];
    matches.push({ path: rel(path), line: d.line_number, col: sub ? sub.start + 1 : 1, preview });
    if (matches.length >= max) { truncated = true; break; }
  }
  return { matches, truncated, engine: "rg" };
}

async function gitGrep(dir, q, { regex, max, ignoreCase }) {
  const args = ["-C", dir, "grep", "-n", "-I", "--no-color"];
  if (ignoreCase) args.push("-i");
  if (!regex) args.push("-F");
  args.push("-e", q);
  const r = await run("git", args, { cwd: dir, timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
  if (r.code !== 0 && r.code !== 1) return { matches: [], truncated: false, error: "search failed", engine: "git-grep" };
  const matches = [];
  let truncated = false;
  for (const line of r.stdout.toString("utf8").split("\n")) {
    if (!line) continue;
    const m = line.match(/^(.*?):(\d+):(.*)$/);
    if (!m) continue;
    matches.push({ path: rel(m[1]), line: Number(m[2]), col: 1, preview: m[3].slice(0, 300) });
    if (matches.length >= max) { truncated = true; break; }
  }
  return { matches, truncated, engine: "git-grep" };
}

const rel = (p) => p.replace(/^\.\//, "");
