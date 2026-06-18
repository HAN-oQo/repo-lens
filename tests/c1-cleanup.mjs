// C1 — Dedupe the README-read block (listTree→findReadme→readRepoFile) behind a
// shared readRepoReadme(dir) used by /api/usage, /api/usageflow, /api/suggest.
// Asserts the dedup (source) AND that the endpoints still return the same shapes
// (no behavior change). Metric: findReadme call-sites + LOC removed.
import { readFileSync } from "node:fs";
import { startServer, waitHealthz, jpost, jget, freshDir, harness } from "./helpers.mjs";

const api = readFileSync("server/api.mjs", "utf8");
const repo = readFileSync("server/lib/repo.mjs", "utf8");
const h = harness("C1");

// --- the dedup ---
h.check("repo.mjs exports readRepoReadme", /export async function readRepoReadme\(dir\)/.test(repo));
const findReadmeSites = (api.match(/findReadme\(/g) || []).length;
const sharedUses = (api.match(/readRepoReadme\(/g) || []).length;
h.check("findReadme called once in api.mjs (only /api/repo)", findReadmeSites === 1, `${findReadmeSites} call-site(s)`);
h.check("the 3 endpoints use the shared helper", sharedUses === 3, `${sharedUses} readRepoReadme() calls`);
h.check("no inline README-read block remains in the GET endpoints", !/const rp = findReadme\(paths\);\s*\n\s*const readme = rp \?/.test(api));

// --- no behavior change: usage/suggest/usageflow still return the same shapes ---
const PORT = 8088, DATA = freshDir("/tmp/repolens-test-c1"), REPO = "sindresorhus/slugify";
const s = startServer({ port: PORT, dataDir: DATA });
await waitHealthz(s.base);
await jpost(s.base, "/api/repo", { url: REPO });

const usage = await jget(s.base, `/api/usage?repo=${encodeURIComponent(REPO)}`);
h.check("/api/usage shape intact (readmePath + snippets + symbols)", !!usage.readmePath && Array.isArray(usage.snippets) && Array.isArray(usage.symbols) && usage.symbols.includes("slugify"), `${usage.snippets?.length} snippets, ${usage.symbols?.length} symbols`);

const suggest = await jget(s.base, `/api/suggest?repo=${encodeURIComponent(REPO)}`);
h.check("/api/suggest shape intact (≥3 suggestions)", Array.isArray(suggest.suggestions) && suggest.suggestions.length >= 3, `${suggest.suggestions?.length} suggestions`);

const uflow = await jget(s.base, `/api/usageflow?repo=${encodeURIComponent(REPO)}`);
h.check("/api/usageflow shape intact (symbols present)", Array.isArray(uflow.symbols) && uflow.symbols.length >= 1, `${uflow.symbols?.length} symbols, status=${uflow.status}`);

const locRemoved = 3 * 2; // 3 endpoints, each shed ~2 lines (paths + rp) for one helper call
console.log(`\n  metric: findReadme call-sites 4→${findReadmeSites}; ~${locRemoved} LOC removed at call-sites; endpoints unchanged`);
s.stop();
h.done();
