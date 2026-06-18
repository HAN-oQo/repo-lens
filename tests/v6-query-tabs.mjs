// V6 — Query-driven tabs (+ suggestion chips). parseVizRequest maps an Ask
// question's phrasing to a viz; handleAskDone opens a NEW graph tab holding that
// query's focus subgraph in the requested viz (default DAG); /api/suggest items
// render as chips that drive the same flow (absorbs U5). Pure fn + source asserts.
import { readFileSync } from "node:fs";
import { harness } from "./helpers.mjs";

const { parseVizRequest } = await import("../lib/vizQuery.ts");
const page = readFileSync("app/page.tsx", "utf8");
const ask = readFileSync("components/AskPanel.tsx", "utf8");
const h = harness("V6");

// --- pure parseVizRequest across phrasings ---
const cases = [
  ["show the request flow as a flowchart", "mermaid"],
  ["render it as a mermaid diagram", "mermaid"],
  ["show as a call tree", "tree"],
  ["give me the step-by-step list", "tree"],
  ["visualize it as a dag", "dag"],
  ["show the dependency graph", "dag"],
  ["just a force graph please", "force"],
  ["what does slugify do?", null],
];
let parsed = 0;
for (const [q, expect] of cases) {
  const got = parseVizRequest(q).viz;
  const ok = got === expect;
  if (ok) parsed++;
  h.check(`"${q.slice(0, 30)}" → ${expect}`, ok, `got ${got}`);
}

// --- handleAskDone opens a query tab in the parsed viz ---
h.check("handleAskDone parses the question's viz (default dag)", /parseVizRequest\(question \|\| ""\)\.viz \|\| "dag"/.test(page));
h.check("opens a NEW query tab", /view: "query"/.test(page) && /setQueryTabs\(/.test(page) && /setActiveTab\(id\)/.test(page));
h.check("query tab renders its own subgraph + viz", /activeQueryTab \? activeQueryTab\.data/.test(page) && /activeQueryTab \? activeQueryTab\.viz/.test(page));
h.check("question threaded from AskPanel onAskDone", /onAskDone\(out\.focusGraph, q\)/.test(ask) && /onAskDone\?: \(focusGraph: any, question\?: string\)/.test(ask));

// --- suggestion chips from /api/suggest (U5) ---
h.check("page fetches /api/suggest for the repo", /apiSuggest\(repo\)\.then/.test(page));
h.check("page passes suggestions to AskPanel", /suggestions=\{suggestions\}/.test(page));
h.check("AskPanel renders suggestion chips that send the question", /\(ctx\.suggestions \|\| \[\]\)\.map/.test(ask) && /onClick=\{\(\) => send\(sug\.question\)\}/.test(ask));

console.log(`\n  metric: parseVizRequest correct on ${parsed}/${cases.length} phrasings; query tabs + suggest chips wired`);
h.done();
