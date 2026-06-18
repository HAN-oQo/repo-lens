// S1 — graph reload from disk skips graphify when the sha is unchanged.
// Build slugify's graph, restart the backend (clears in-memory state), reload,
// and assert the graph comes back ready quickly via the on-disk cache.
import { startServer, waitHealthz, jpost, pollGraph, jget, freshDir, sleep, harness } from "./helpers.mjs";

const PORT = 8097;
const DATA = freshDir("/tmp/repolens-test-s1");
const REPO = "sindresorhus/slugify";
const h = harness("S1");

let s = startServer({ port: PORT, dataDir: DATA });
await waitHealthz(s.base);

// 1) first build
await jpost(s.base, "/api/repo", { url: REPO });
const first = await pollGraph(s.base, REPO);
h.check("first build reaches ready", first.status === "ready", `${first.ms}ms`);
s.stop();
await sleep(800);

// 2) restart (in-memory state gone; graph.json + .repolens-sha persist on disk)
s = startServer({ port: PORT, dataDir: DATA });
await waitHealthz(s.base);
await jpost(s.base, "/api/repo", { url: REPO });
const second = await pollGraph(s.base, REPO);
h.check("reload reaches ready", second.status === "ready", `${second.ms}ms`);
h.check("reload is fast (<2000ms)", second.ms < 2000, `${second.ms}ms (build was ${first.ms}ms)`);

// 3) the activity log proves graphify was skipped
const act = await jget(s.base, `/api/activity?repo=${encodeURIComponent(REPO)}`).catch(() => ({ lines: [] }));
const reused = (act.lines || []).some((l) => /reusing cached build/i.test(l.msg));
h.check("activity log shows cache reuse (graphify skipped)", reused);

console.log(`\n  metric: first_build=${first.ms}ms  cached_reload=${second.ms}ms  speedup=${(first.ms / Math.max(1, second.ms)).toFixed(1)}x`);
s.stop();
h.done();
