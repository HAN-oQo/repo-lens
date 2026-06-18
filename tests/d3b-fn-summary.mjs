// D3b — /api/summary with &symbol= returns a one-line role for a single function,
// sliced from its D2 sourceLocation (± a window), cached like D3. Asserts the
// slugify() role mentions slug/string behavior; second call is cache-fast.
// Metric: first vs cached ms. Needs a configured LLM (.env ASK_URL) + a ready graph
// (for the symbol's location), so the test polls /api/graph first.
import { startServer, waitHealthz, jpost, jget, pollGraph, freshDir, harness, loadDotenv } from "./helpers.mjs";

loadDotenv();
const PORT = 8092;
const DATA = freshDir("/tmp/repolens-test-d3b");
const REPO = "sindresorhus/slugify";
const h = harness("D3b");

h.check("LLM endpoint configured", !!(process.env.ASK_URL || process.env.ANTHROPIC_API_KEY), process.env.ASK_URL ? "ASK_URL" : "ANTHROPIC_API_KEY");

const s = startServer({ port: PORT, dataDir: DATA });
await waitHealthz(s.base);
await jpost(s.base, "/api/repo", { url: REPO });
const g = await pollGraph(s.base, REPO); // graph ready → symbol location resolves via D2
h.check("graph ready (for symbol location)", g.status === "ready", `status=${g.status} in ${g.ms}ms`);

const t1 = Date.now();
const first = await jget(s.base, `/api/summary?repo=${encodeURIComponent(REPO)}&path=index.js&symbol=slugify`);
const firstMs = Date.now() - t1;

h.check("first call returns a summary (no error)", !!first.summary && !first.error, (first.summary || first.error || "").slice(0, 80));
h.check("one line", typeof first.summary === "string" && !first.summary.includes("\n"));
h.check("describes slug/string behavior", /slug|string|url|separator|hyphen|dash/i.test(first.summary || ""), first.summary);
h.check("echoes symbol", first.symbol === "slugify");
h.check("first not cached", first.cached === false, `cached=${first.cached}`);

const t2 = Date.now();
const second = await jget(s.base, `/api/summary?repo=${encodeURIComponent(REPO)}&path=index.js&symbol=slugify`);
const secondMs = Date.now() - t2;
h.check("second served from cache", second.cached === true, `cached=${second.cached}`);
h.check("cached summary identical", second.summary === first.summary);
h.check("cached much faster", secondMs < Math.max(50, firstMs / 5), `${secondMs}ms vs ${firstMs}ms`);

// a per-function summary must be distinct from the whole-file summary (different cache key)
const fileSum = await jget(s.base, `/api/summary?repo=${encodeURIComponent(REPO)}&path=index.js`);
h.check("function summary keyed separately from file summary", fileSum.summary !== first.summary || fileSum.cached === false);

console.log(`\n  metric: first=${firstMs}ms (LLM) → cached=${secondMs}ms (${(firstMs / Math.max(1, secondMs)).toFixed(0)}x faster)`);
console.log(`  slugify role: "${first.summary}"`);
s.stop();
h.done();
