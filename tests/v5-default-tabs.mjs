// V5 — On repo load the graph area seeds two tabs: "Overview" (full graph) and
// "Quickstart" (usage flow), rendered in the current viz. Source-asserts the two
// seeded tabs + view-branched GraphView, and smoke-tests that the backend has data
// for both (overview = /api/graph, quickstart = /api/usageflow). Metric: tabs seeded.
import { readFileSync } from "node:fs";
import { startServer, waitHealthz, jpost, jget, pollGraph, freshDir, harness } from "./helpers.mjs";

const page = readFileSync("app/page.tsx", "utf8");
const h = harness("V5");

// --- the two seeded tabs ---
h.check("GRAPH_TABS defines Overview + Quickstart with views", /id: GRAPH_OVERVIEW, title: "Overview", view: "overview"/.test(page) && /id: GRAPH_QUICKSTART, title: "Quickstart", view: "quickstart"/.test(page));
h.check("loadRepo seeds the graph tabs on load", /setTabs\(\[\{ kind: "readme"[\s\S]*?\.\.\.GRAPH_TABS\]\)/.test(page));
h.check("active tab stays README after seeding", /\.\.\.GRAPH_TABS\]\);\s*\n\s*setActiveTab\("__README__"\)/.test(page));
h.check("GraphView shows usage-flow only for non-overview tabs", /activeTabObj\.view === "overview" \? null : focusGraph/.test(page));
h.check("a graph tab activating builds lazily", /activeTab === GRAPH_OVERVIEW \|\| activeTab === GRAPH_QUICKSTART\) buildGraphIfNeeded\(\)/.test(page));

// --- backend has data for BOTH tabs ---
const PORT = 8089, DATA = freshDir("/tmp/repolens-test-v5"), REPO = "sindresorhus/slugify";
const s = startServer({ port: PORT, dataDir: DATA });
await waitHealthz(s.base);
await jpost(s.base, "/api/repo", { url: REPO });
const g = await pollGraph(s.base, REPO);
h.check("graph ready", g.status === "ready", `status=${g.status} in ${g.ms}ms`);

const overview = await jget(s.base, `/api/graph?repo=${encodeURIComponent(REPO)}`);
h.check("Overview tab data present (/api/graph)", overview.status === "ready" && (overview.nodes?.length || 0) > 0, `${overview.nodes?.length} nodes`);

const quickstart = await jget(s.base, `/api/usageflow?repo=${encodeURIComponent(REPO)}`);
h.check("Quickstart tab data present (/api/usageflow)", quickstart.status === "ready" && (quickstart.nodes?.length || 0) > 0, `${quickstart.nodes?.length} nodes`);

h.check("Quickstart is a focused subset of Overview", (quickstart.nodes?.length || 0) <= (overview.nodes?.length || 0), `${quickstart.nodes?.length} ≤ ${overview.nodes?.length}`);

console.log(`\n  metric: 2 graph tabs seeded (Overview ${overview.nodes?.length} nodes · Quickstart ${quickstart.nodes?.length} nodes)`);
s.stop();
h.done();
