// U4 — opening the graph tab defaults to the README usage-flow subgraph (focus),
// not the big overview; "Full overview" switches. Source-asserts the wiring and
// confirms the data the default uses (usage flow ready + smaller than overview).
import { readFileSync } from "node:fs";
import { startServer, waitHealthz, jpost, jget, pollGraph, freshDir, harness } from "./helpers.mjs";

const PORT = 8093;
const DATA = freshDir("/tmp/repolens-test-u4");
const REPO = "sindresorhus/slugify";
const h = harness("U4");

// 1) wiring
const page = readFileSync("app/page.tsx", "utf8");
h.check("openGraph fetches the usage flow", /apiUsageFlow\(repo\)/.test(page));
h.check("usage flow set as default focus + label", /setFocusGraph\(flow\)/.test(page) && /setFocusLabel\("Usage flow/.test(page));
const gv = readFileSync("components/GraphView.tsx", "utf8");
h.check("GraphView renders focus over overview", gv.includes("focusGraph || data"));
h.check('"Full overview" button present', gv.includes("Full overview"));

// 2) the payload the default uses
const s = startServer({ port: PORT, dataDir: DATA });
await waitHealthz(s.base);
await jpost(s.base, "/api/repo", { url: REPO });
await pollGraph(s.base, REPO);
const overview = await jget(s.base, `/api/graph?repo=${encodeURIComponent(REPO)}`);
const flow = await jget(s.base, `/api/usageflow?repo=${encodeURIComponent(REPO)}`);
const ovN = overview.totalNodes || overview.nodes?.length || 0;
h.check("usage flow ready with nodes", flow.status === "ready" && flow.nodes?.length > 0, `${flow.nodes?.length} nodes`);
h.check("flow is smaller than the overview", flow.nodes.length < ovN, `${flow.nodes.length} < ${ovN}`);

console.log(`\n  metric: default usage-flow ${flow.nodes?.length} nodes vs overview ${ovN}`);
s.stop();
h.done();
