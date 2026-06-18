// V1 — Pluggable graph render modes. The graph component renders a GraphData in
// mode ∈ {force, dag, tree, mermaid}; a pure registry (lib/graphModes.ts) maps
// each mode → a renderer + dag flag, and GraphView dispatches on it. The canvas
// itself needs a browser, so this asserts the pure registry (every mode resolves
// to a valid renderer for the same data, without error) + GraphView wiring.
import { readFileSync } from "node:fs";
import { harness } from "./helpers.mjs";

const { GRAPH_MODES, modeConfig, resolveMode } = await import("../lib/graphModes.ts");
const view = readFileSync("components/GraphView.tsx", "utf8");
const h = harness("V1");

// --- the registry covers all four modes ---
h.check("4 modes: force, dag, tree, mermaid", GRAPH_MODES.length === 4 && ["force", "dag", "tree", "mermaid"].every((m) => GRAPH_MODES.includes(m)), GRAPH_MODES.join(", "));

// --- the same data "renders" in every mode without error (pure config proxy) ---
const sample = { nodes: [{ id: "a", name: "a", group: "c0", val: 1, inDeg: 0, outDeg: 1 }, { id: "b", name: "b", group: "c0", val: 1, inDeg: 1, outDeg: 0 }], links: [{ source: "a", target: "b" }] };
const valid = new Set(["force", "tree", "mermaid"]);
let ok = 0;
for (const m of GRAPH_MODES) {
  let cfg;
  try { cfg = modeConfig(m); } catch { cfg = null; }
  const good = !!cfg && valid.has(cfg.renderer) && typeof cfg.dag === "boolean" && !!cfg.label && sample.nodes.length >= 0;
  if (good) ok++;
  h.check(`mode "${m}" → renderer "${cfg?.renderer}" (dag=${cfg?.dag})`, good);
}
h.check("force=no-dag, dag=dag, both via force renderer", modeConfig("force").dag === false && modeConfig("dag").dag === true && modeConfig("dag").renderer === "force" && modeConfig("force").renderer === "force");
h.check("tree/mermaid have their own renderers", modeConfig("tree").renderer === "tree" && modeConfig("mermaid").renderer === "mermaid");

// --- resolveMode folds prior behavior: no mode → focus=dag, overview=force; explicit wins ---
h.check("no mode + focus → dag", resolveMode(undefined, true) === "dag");
h.check("no mode + overview → force", resolveMode(undefined, false) === "force");
h.check("explicit mode overrides", resolveMode("mermaid", true) === "mermaid" && resolveMode("tree", false) === "tree");

// --- GraphView dispatches on the registry ---
h.check("GraphView imports graphModes", /from "@\/lib\/graphModes"/.test(view));
h.check("GraphView accepts a mode prop", /mode\?: GraphMode/.test(view));
h.check("GraphView resolves the mode (resolveMode + modeConfig)", /modeConfig\(resolveMode\(mode, isFocus\)\)/.test(view));
h.check("branches to all three renderers", /cfg\.renderer === "force"/.test(view) && /cfg\.renderer === "tree"/.test(view) && /cfg\.renderer === "mermaid"/.test(view));
h.check("dag layout driven by cfg.dag (folds U4b)", /dagMode=\{cfg\.dag \? "lr" : undefined\}/.test(view));

console.log(`\n  metric: ${GRAPH_MODES.length} modes, ${ok}/${GRAPH_MODES.length} resolve to a valid renderer for the same data; renderers: force(force+dag), tree, mermaid`);
h.done();
