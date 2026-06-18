// S2 — Explorer caps how many children of a directory render at once, so a huge
// directory doesn't freeze the browser. Tests the pure cap helper that the
// Explorer component uses (no live browser needed).
import { harness } from "./helpers.mjs";

const { visibleChildren } = await import("../lib/tree.ts");
const h = harness("S2");

// synthetic directory with 5000 children
const kids = Array.from({ length: 5000 }, (_, i) => ({ name: "f" + i, path: "d/f" + i, type: "blob" }));

const capped = visibleChildren(kids, false); // showAll=false
h.check("caps to 300 rows when collapsed", capped.shown.length === 300, `rendered ${capped.shown.length} (was ${kids.length})`);
h.check("reports the hidden remainder", capped.more === 4700, `more=${capped.more}`);

const all = visibleChildren(kids, true); // showAll=true
h.check('"show all" reveals every child', all.shown.length === 5000 && all.more === 0, `rendered ${all.shown.length}, more=${all.more}`);

const small = visibleChildren(Array.from({ length: 42 }, (_, i) => i), false);
h.check("small dirs are not capped", small.shown.length === 42 && small.more === 0, `rendered ${small.shown.length}`);

console.log(`\n  metric: 5000-child dir → ${capped.shown.length} DOM rows (vs ${kids.length} = ${(kids.length / capped.shown.length).toFixed(1)}x fewer); "show all" → ${all.shown.length}`);
h.done();
