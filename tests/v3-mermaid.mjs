// V3 — toMermaid(graph) → a `flowchart LR` with sanitized ids + directed edges.
// Asserts: starts with `flowchart LR`, has a `slugify --> …` edge, ids sanitized,
// and mermaid.parse() accepts it (run under jsdom, since mermaid needs a DOM).
// Metric: nodes/edges.
import { readFileSync } from "node:fs";
import { startServer, waitHealthz, jpost, jget, pollGraph, freshDir, harness } from "./helpers.mjs";

const { toMermaid, buildMermaid } = await import("../lib/mermaid.ts");
const view = readFileSync("components/GraphView.tsx", "utf8");
const h = harness("V3");

// --- pure: special-char names get sanitized ids; real names stay as labels ---
const synth = {
  nodes: [{ id: "index_slugify", name: "slugify()" }, { id: "index_decamelize", name: "decamelize()" }, { id: "a.b/c", name: "a.b/c" }],
  links: [{ source: "index_slugify", target: "index_decamelize" }, { source: "index_slugify", target: "a.b/c" }],
};
const code0 = toMermaid(synth);
h.check("starts with 'flowchart LR'", code0.startsWith("flowchart LR"), code0.split("\n")[0]);
h.check("node ids are sanitized (alnum/underscore only)", [...code0.matchAll(/^\s{2}([^\s\[]+)\[/gm)].every((m) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(m[1])), "decl ids ok");
h.check("real name kept as a quoted label", code0.includes('["a.b/c"]'));
h.check("has a 'slugify --> ' directed edge", /\bslugify --> /.test(code0), code0.split("\n").find((l) => l.includes("-->")));

// --- GraphView wiring ---
h.check("GraphView has MermaidView from buildMermaid", /function MermaidView/.test(view) && /buildMermaid\(data\)/.test(view));
h.check("mermaid mode dispatches to MermaidView", /cfg\.renderer === "mermaid" &&\s*\(\s*<MermaidView/.test(view));
h.check("node clicks open the source file", /onOpenFile\(file\)/.test(view));

// --- live slugify usage subgraph ---
const PORT = 8090, DATA = freshDir("/tmp/repolens-test-v3"), REPO = "sindresorhus/slugify";
const s = startServer({ port: PORT, dataDir: DATA });
await waitHealthz(s.base);
await jpost(s.base, "/api/repo", { url: REPO });
const g = await pollGraph(s.base, REPO);
h.check("graph ready", g.status === "ready", `status=${g.status} in ${g.ms}ms`);
const uf = await jget(s.base, `/api/usageflow?repo=${encodeURIComponent(REPO)}`);
const built = buildMermaid({ nodes: uf.nodes, links: uf.links });
h.check("slugify subgraph → flowchart with edges", built.code.startsWith("flowchart LR") && built.edges > 0, `${built.nodes.length} nodes / ${built.edges} edges`);
h.check("includes a slugify edge", /\bslugify --> /.test(built.code));

// --- mermaid.parse() accepts it (jsdom hosts mermaid's DOM needs) ---
let parseOk = false, parseNote = "";
try {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const mermaid = (await import("mermaid")).default;
  const r = await mermaid.parse(built.code);
  parseOk = !!r;
  parseNote = JSON.stringify(r);
} catch (e) {
  parseNote = String(e?.message || e).slice(0, 140);
}
h.check("mermaid.parse() accepts the flowchart", parseOk, parseNote);

console.log(`\n  metric: slugify flowchart → ${built.nodes.length} nodes / ${built.edges} edges; mermaid.parse → ${parseNote}`);
s.stop();
h.done();
