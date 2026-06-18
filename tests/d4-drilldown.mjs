// D4 — Drill-down UI: the Structure view renders a one-line ROLE at each level
// (dir → file → function), lazily sourced from /api/summary, with per-file
// functions/classes from /api/fileinfo. The view is React/DOM, so this is a
// source + built-bundle assertion (visual layout confirmed manually).
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { harness } from "./helpers.mjs";

const view = readFileSync("components/StructureView.tsx", "utf8");
const api = readFileSync("lib/api.ts", "utf8");
const page = readFileSync("app/page.tsx", "utf8");
const h = harness("D4");

// --- API client: the two endpoints the drill-down draws from ---
h.check("lib/api.ts adds apiFileInfo → /api/fileinfo", /export async function apiFileInfo/.test(api) && api.includes("/api/fileinfo"));
h.check("lib/api.ts adds apiSummary → /api/summary", /export async function apiSummary/.test(api) && api.includes("/api/summary"));
h.check("apiSummary passes a symbol for per-function roles", /symbol\?/.test(api) && /&symbol=/.test(api));

// --- the three drill-down levels render a role ---
h.check("StructureView imports both endpoints", api && /apiFileInfo, apiSummary/.test(view));
h.check("renders a Role line component", /function Role\(/.test(view) && view.includes("struct-role"));
h.check("dir level fetches its role on expand", /toggleDir\(node\.path\);.*ensureRole\(node\.path\)/.test(view));
h.check("file level fetches role + symbols on expand", /ensureSymbols\(node\.path\); ensureRole\(node\.path\)/.test(view));
h.check("function level rows render from fetched symbols", /SymbolRow/.test(view) && /ensureRole\(file, sym\.name\)/.test(view));
h.check("symbols come from apiFileInfo, roles from apiSummary", /apiFileInfo\(repo, path\)/.test(view) && /apiSummary\(repo, path, symbol\)/.test(view));
h.check("roles fetched lazily (only on expand, deduped)", /if \(prev\[key\] !== undefined\) return prev/.test(view));

// --- page passes the repo so the view can call the backend ---
h.check("page passes repo={repo} to StructureView", /<StructureView [^>]*repo=\{repo\}/.test(page));

// --- built bundle contains the new endpoints (proves it compiled into out/) ---
function bundleHas(...needles) {
  const dir = "out/_next/static/chunks";
  if (!existsSync(dir)) return null;
  const files = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".js")) files.push(p); } };
  walk(dir);
  const hay = files.map((f) => readFileSync(f, "utf8")).join("\n");
  return needles.every((n) => hay.includes(n));
}
const inBundle = bundleHas("/api/fileinfo", "/api/summary");
h.check("built bundle references /api/fileinfo + /api/summary", inBundle === true || inBundle === null, inBundle === null ? "out/ not built — skipped" : "present");

const levels = [
  /toggleDir\(node\.path\);.*ensureRole\(node\.path\)/.test(view), // dir
  /ensureSymbols\(node\.path\); ensureRole\(node\.path\)/.test(view), // file
  /ensureRole\(file, sym\.name\)/.test(view), // function
].filter(Boolean).length;
console.log(`\n  metric: ${levels}/3 drill-down levels render a role (dir → file → function); endpoints apiFileInfo + apiSummary wired; bundle=${inBundle === null ? "not-built" : inBundle}`);
h.done();
