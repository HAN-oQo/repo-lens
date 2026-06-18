// U4b — the focus/usage-flow graph is laid out as a left→right DAG (so call order
// reads as a flow), while the overview keeps the force layout. Source assertion on
// GraphView (the layout itself is canvas — confirmed visually in the browser).
import { readFileSync } from "node:fs";
import { harness } from "./helpers.mjs";

const src = readFileSync("components/GraphView.tsx", "utf8");
const h = harness("U4b");

h.check("dagMode is left→right when focusGraph is active", /dagMode=\{focusGraph \? "lr" : undefined\}/.test(src));
h.check("tolerates cycles via onDagError", /onDagError=\{/.test(src));
h.check("sets a dag level distance", /dagLevelDistance=/.test(src));
h.check("directional arrows present (call direction)", src.includes("linkDirectionalArrowLength"));
h.check("overview (no focus) → no dagMode (force layout)", src.includes('focusGraph ? "lr" : undefined'));

console.log("\n  metric: DAG (lr) layout enabled for focus/usage-flow only; force layout for overview");
h.done();
