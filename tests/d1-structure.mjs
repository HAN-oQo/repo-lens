// D1 — Structure panel + activity-bar icon. A new 📂 left view renders a Finder-like
// directory map (StructureView) distinct from the Explorer file tree. The view itself
// is React/DOM, so this is a source-wiring assertion (per the unit's "bundle/source
// check"): the component exists, the dirStats helper backs it, and page.tsx adds the
// activity-bar button + sidebar branch wired to a "structure" leftView.
import { readFileSync } from "node:fs";
import { harness } from "./helpers.mjs";

const page = readFileSync("app/page.tsx", "utf8");
const view = readFileSync("components/StructureView.tsx", "utf8");
const tree = readFileSync("lib/tree.ts", "utf8");
const h = harness("D1");

// --- the new component ---
h.check("StructureView is a default-exported component", /export default function StructureView/.test(view));
h.check("StructureView renders a tree of nodes", view.includes('className="tree"') && /StructNode/.test(view));
h.check("StructureView labels dirs with subtree size (dir-meta)", view.includes("dir-meta") && /dirStats\(/.test(view));
h.check("StructureView opens files via onOpen", /onClick=\{\(\) => onOpen\(node\.path\)\}/.test(view));

// --- the pure helper backing the directory map ---
h.check("lib/tree.ts exports dirStats(node) → {dirs, files}", /export function dirStats/.test(tree) && tree.includes("dirs") && tree.includes("files"));

// --- wiring in app/page.tsx ---
h.check("page imports StructureView", /import StructureView from "@\/components\/StructureView"/.test(page));
h.check('leftView state includes "structure"', /"explorer" \| "structure" \| "search"/.test(page));
h.check("activity-bar 📂 button sets leftView=structure", /title="Structure" onClick=\{\(\) => setLeftView\("structure"\)\}/.test(page) && page.includes("📂"));
h.check("sidebar renders StructureView when leftView==='structure'", /leftView === "structure" \?[\s\S]*?<StructureView /.test(page));

// metric: count the distinct wiring points proven present
const wiring = [
  /import StructureView/.test(page),
  /"explorer" \| "structure" \| "search"/.test(page),
  /setLeftView\("structure"\)/.test(page),
  /<StructureView /.test(page),
].filter(Boolean).length;
console.log(`\n  metric: StructureView + dirStats present; ${wiring}/4 page-wiring points (import, state, button, render); new activity-bar buttons: +1 (📂)`);
h.done();
