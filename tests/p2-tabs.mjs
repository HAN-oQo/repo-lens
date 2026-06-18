// P2 — Restore open tabs + active tab on reload. Pure serializeTabs/parseTabs
// round-trips the restorable tabs (README, files, seeded graph tabs; query tabs
// dropped) + active id; source asserts the per-repo persist effect and the
// restore-on-load path. Metric: tabs restored.
import { readFileSync } from "node:fs";
import { harness } from "./helpers.mjs";

const { serializeTabs, parseTabs } = await import("../lib/persist.ts");
const page = readFileSync("app/page.tsx", "utf8");
const h = harness("P2");

// --- pure round-trip ---
const tabs = [
  { kind: "readme", id: "__README__", title: "README" },
  { kind: "graph", id: "__GRAPH_OVERVIEW__", title: "Overview", view: "overview" },
  { kind: "graph", id: "__GRAPH_QUERY1__", title: "trace x", view: "query" }, // should be dropped
  { kind: "file", id: "src/index.js", title: "index.js" },
  { kind: "file", id: "src/util.js", title: "util.js" },
];
const back = parseTabs(serializeTabs(tabs, "src/index.js"));
h.check("round-trips to an object with tabs + active", !!back && Array.isArray(back.tabs));
h.check("transient query tab dropped", !back.tabs.some((t) => t.view === "query"), `${back.tabs.length} tabs kept`);
h.check("README + overview + 2 files kept (4)", back.tabs.length === 4, back.tabs.map((t) => t.id).join(", "));
h.check("file tabs preserved with ids/titles", back.tabs.some((t) => t.kind === "file" && t.id === "src/index.js" && t.title === "index.js"));
h.check("active tab preserved", back.active === "src/index.js", back.active);
h.check("null / garbage → null", parseTabs(null) === null && parseTabs("{not json") === null);

// active that's a dropped query tab → caller falls back; parse still returns it,
// restore logic guards with `restored.some(...)`. Confirm parse keeps a valid active.
const back2 = parseTabs(serializeTabs([{ kind: "file", id: "a.js", title: "a.js" }], "a.js"));
h.check("single file tab round-trips", back2.tabs.length === 1 && back2.active === "a.js");

// --- source: persist per repo + restore on load + lazy content fetch ---
h.check("persists tabs per repo to TABS_LS", /map\[`\$\{repo\.owner\}\/\$\{repo\.repo\}`\] = JSON\.parse\(serializeTabs\(tabs, activeTab\)\)/.test(page) && /localStorage\.setItem\(TABS_LS/.test(page));
h.check("loadRepo restores saved tabs for the repo", /parseTabs\(map\[`\$\{ref\.owner\}\/\$\{ref\.repo\}`\]\)/.test(page));
h.check("restores file tabs + active for the matching repo", /saved\.tabs\.filter\(\(t\) => t\.kind === "file"/.test(page) && /setActiveTab\(restoredActive\)/.test(page));
h.check("restored/clicked file tab lazily loads content", /contents\[activeTab\] === undefined[\s\S]*?openFile\(activeTab\)/.test(page));

console.log(`\n  metric: ${tabs.length} tabs in → ${back.tabs.length} restorable kept (query dropped), active="${back.active}"`);
h.done();
