// U2 — the usage-flow subgraph is seeded by the README's usage symbols and
// contains the entry point (slugify) + its callees, smaller than the full graph.
import { startServer, waitHealthz, jpost, jget, pollGraph, freshDir, harness } from "./helpers.mjs";

const PORT = 8095;
const DATA = freshDir("/tmp/repolens-test-u2");
const REPO = "sindresorhus/slugify";
const h = harness("U2");

const s = startServer({ port: PORT, dataDir: DATA });
await waitHealthz(s.base);

await jpost(s.base, "/api/repo", { url: REPO });
const g = await pollGraph(s.base, REPO);            // wait for the symbol graph
h.check("graph built", g.status === "ready", g.status);
const full = (await jget(s.base, `/api/graph?repo=${encodeURIComponent(REPO)}`)).totalNodes || g.graph?.totalNodes || 0;

const flow = await jget(s.base, `/api/usageflow?repo=${encodeURIComponent(REPO)}`);
h.check("usage flow is ready", flow.status === "ready", flow.status);
const names = (flow.nodes || []).map((n) => String(n.name || "").replace(/\(\)$/, "").toLowerCase());
h.check("flow centers on the entry point (slugify)", names.includes("slugify"), names.slice(0, 8).join(", "));
h.check("flow includes callees (>1 node)", (flow.nodes || []).length > 1, `${flow.nodes?.length} nodes`);
h.check("flow is a subset of the full graph", flow.nodes.length < full, `${flow.nodes.length} < ${full}`);
h.check("usage symbols echoed back", Array.isArray(flow.symbols) && flow.symbols.includes("slugify"));

console.log(`\n  metric: usage-flow ${flow.nodes?.length} nodes / ${flow.links?.length} links (full graph ${full}); seeds [${(flow.symbols || []).slice(0, 5).join(", ")}]`);
s.stop();
h.done();
