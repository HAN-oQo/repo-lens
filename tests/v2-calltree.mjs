// V2 — toCallTree(graph, root?) turns a GraphData into an ordered, numbered,
// nested tree by following directed links, breaking cycles. Asserts: the slugify
// usage subgraph yields a tree rooted at slugify with ordered children; a cyclic
// graph terminates (no infinite loop). Metric: depth, node count.
import { readFileSync } from "node:fs";
import { startServer, waitHealthz, jpost, jget, pollGraph, freshDir, harness } from "./helpers.mjs";

const { toCallTree, flattenCallTree } = await import("../lib/callTree.ts");
const h = harness("V2");

// --- 0) GraphView renders the call tree in tree mode (indented rows, click→open) ---
const view = readFileSync("components/GraphView.tsx", "utf8");
h.check("GraphView has a CallTreeView using toCallTree", /function CallTreeView/.test(view) && /toCallTree\(data\)/.test(view));
h.check("tree mode renders CallTreeView (not the stub)", /cfg\.renderer === "tree" &&\s*\(\s*<CallTreeView/.test(view));
h.check("rows are indented by depth + open the source file", /paddingLeft: 6 \+ n\.depth \* 16/.test(view) && /onOpenFile\(n\.sourceFile \|\| n\.id\)/.test(view));

// --- 1) cycle safety (pure, no server): a→b→c→a must terminate ---
const cyclic = {
  nodes: [{ id: "a", name: "a" }, { id: "b", name: "b" }, { id: "c", name: "c" }],
  links: [{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "c", target: "a" }],
};
const ct = toCallTree(cyclic, "a");
h.check("cyclic graph terminates (finite count)", ct.count > 0 && ct.count < 100, `count=${ct.count}, depth=${ct.depth}`);
h.check("cycle edge is marked, not recursed", flattenCallTree(ct.tree).some((n) => n.cycle), "↩ leaf present");
h.check("root is the requested entry (a)", ct.tree?.name === "a");

// --- 2) the slugify usage subgraph, rooted at slugify ---
const PORT = 8091;
const DATA = freshDir("/tmp/repolens-test-v2");
const REPO = "sindresorhus/slugify";
const s = startServer({ port: PORT, dataDir: DATA });
await waitHealthz(s.base);
await jpost(s.base, "/api/repo", { url: REPO });
const g = await pollGraph(s.base, REPO);
h.check("graph ready", g.status === "ready", `status=${g.status} in ${g.ms}ms`);

const uf = await jget(s.base, `/api/usageflow?repo=${encodeURIComponent(REPO)}`);
h.check("usage subgraph has nodes", (uf.nodes || []).length > 1, `${uf.nodes?.length} nodes / ${uf.links?.length} links`);

const tree = toCallTree({ nodes: uf.nodes, links: uf.links }, "slugify");
const rootName = String(tree.tree?.name || "").replace(/\(\)$/, "");
h.check("rooted at slugify", rootName === "slugify", `root="${tree.tree?.name}"`);
h.check("root has ordered children (the flow)", (tree.tree?.children?.length || 0) >= 1, `${tree.tree?.children?.length} children`);
h.check("steps are numbered in pre-order", (() => {
  const rows = flattenCallTree(tree.tree);
  return rows.length > 0 && rows.every((n, i) => n.step === i + 1);
})());
h.check("no infinite loop on real data (bounded count)", tree.count > 1 && tree.count <= 500, `count=${tree.count}`);

console.log(`\n  metric: slugify call-tree → ${tree.count} steps, depth ${tree.depth}; cyclic-guard count=${ct.count}`);
s.stop();
h.done();
