// D3 — /api/summary?repo=&path= returns a one-line role for a file/dir, computed
// via the LLM and cached to disk keyed by sha. Asserts: first call yields a
// single-line summary; second call is served from cache (cached:true) and is far
// faster (no LLM). Metric: first vs cached ms.
//
// Needs a configured LLM (ASK_URL/ASK_TOKEN in .env) — loadDotenv() makes the
// spawned server inherit it. If none is configured the test fails loudly.
import { startServer, waitHealthz, jpost, jget, freshDir, harness, loadDotenv } from "./helpers.mjs";

loadDotenv();
const PORT = 8093;
const DATA = freshDir("/tmp/repolens-test-d3");
const REPO = "sindresorhus/slugify";
const h = harness("D3");

h.check("LLM endpoint configured (.env ASK_URL or ANTHROPIC_API_KEY)", !!(process.env.ASK_URL || process.env.ANTHROPIC_API_KEY), process.env.ASK_URL ? "ASK_URL" : process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY" : "none");

const s = startServer({ port: PORT, dataDir: DATA });
await waitHealthz(s.base);
await jpost(s.base, "/api/repo", { url: REPO }); // clone (gives us a HEAD sha to key on)

const t1 = Date.now();
const first = await jget(s.base, `/api/summary?repo=${encodeURIComponent(REPO)}&path=index.js`);
const firstMs = Date.now() - t1;

h.check("first call returns a summary (no error)", !!first.summary && !first.error, (first.summary || first.error || "").slice(0, 80));
h.check("summary is one line", typeof first.summary === "string" && !first.summary.includes("\n"));
h.check("first call was not cached", first.cached === false, `cached=${first.cached}`);

const t2 = Date.now();
const second = await jget(s.base, `/api/summary?repo=${encodeURIComponent(REPO)}&path=index.js`);
const secondMs = Date.now() - t2;

h.check("second call served from cache", second.cached === true, `cached=${second.cached}`);
h.check("cached summary identical", second.summary === first.summary);
h.check("cached call is much faster", secondMs < Math.max(50, firstMs / 5), `${secondMs}ms vs ${firstMs}ms`);

console.log(`\n  metric: first=${firstMs}ms (LLM) → cached=${secondMs}ms (${firstMs > 0 ? (firstMs / Math.max(1, secondMs)).toFixed(0) : "?"}x faster)`);
console.log(`  summary: "${first.summary}"`);
s.stop();
h.done();
