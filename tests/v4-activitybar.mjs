// V4 — Left activity-bar viz entries. New buttons (DAG / call-tree / mermaid)
// beside File · Structure · Search · Graph set the active graph viz mode, which
// flows to GraphView's `mode` prop. The activity bar is React/DOM, so this is a
// source + built-bundle assertion. Metric: # viz buttons added.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { harness } from "./helpers.mjs";

const page = readFileSync("app/page.tsx", "utf8");
const h = harness("V4");

h.check("page imports the mode registry", /from "@\/lib\/graphModes"/.test(page) && /modeConfig/.test(page));
h.check("graphMode state exists", /const \[graphMode, setGraphMode\] = useState<GraphMode \| null>/.test(page));
h.check("showViz opens the graph + sets the mode", /const showViz = useCallback\(\(m: GraphMode\) => \{ setGraphMode\(m\); openGraph\(\); \}/.test(page));

// the three new activity-bar buttons, generated from the registry
h.check("activity bar maps dag/tree/mermaid → buttons", /\(\["dag", "tree", "mermaid"\] as GraphMode\[\]\)\.map/.test(page));
h.check("each viz button calls showViz(m)", /onClick=\{\(\) => showViz\(m\)\}/.test(page));
h.check("buttons label/icon from modeConfig", /const c = modeConfig\(m\)/.test(page) && /\{c\.icon\}/.test(page) && /title=\{c\.label\}/.test(page));
h.check("🕸 Graph button resets to default mode", /setGraphMode\(null\); openGraph\(\)/.test(page));
h.check("active highlight reflects graphMode", /activeTabObj\?\.kind === "graph" && graphMode === m \? "active"/.test(page));

// the mode flows to GraphView
h.check("GraphView receives mode={graphMode}", /<GraphView [^>]*mode=\{graphMode\}/.test(page));

// built bundle carries the viz mode labels (DAG flow / Call tree / Flowchart)
function bundleHas(...needles) {
  const dir = "out/_next/static/chunks";
  if (!existsSync(dir)) return null;
  const files = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".js")) files.push(p); } };
  walk(dir);
  const hay = files.map((f) => readFileSync(f, "utf8")).join("\n");
  return needles.every((n) => hay.includes(n));
}
const inBundle = bundleHas("DAG flow", "Call tree", "Flowchart");
h.check("bundle has the viz mode labels", inBundle === true || inBundle === null, inBundle === null ? "out/ not built — skipped" : "present");

const buttons = (page.match(/\(\["dag", "tree", "mermaid"\] as GraphMode\[\]\)/) ? 3 : 0);
console.log(`\n  metric: +${buttons} activity-bar viz buttons (DAG, Call tree, Flowchart) → graphMode → GraphView; bundle labels=${inBundle === null ? "not-built" : inBundle}`);
h.done();
