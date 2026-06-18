// graphify integration: build a code-only symbol graph (no LLM) and adapt its
// graph.json (NetworkX node-link) to our GraphData shape.
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { run } from "./util.mjs";

export async function graphifyAvailable() {
  const r = await run("graphify", ["--version"], { timeout: 10000 });
  return r.code === 0;
}

/** `graphify update` re-extracts code files with NO LLM — free, local, fast.
 *  onProgress(line) streams graphify's own output for live UI feedback. */
export async function buildGraphJson(repoDir, onProgress) {
  const r = await run("graphify", ["update", "."], {
    cwd: repoDir, timeout: 900000, maxBuffer: 8 * 1024 * 1024,
    onLine: onProgress ? (line) => onProgress(line) : undefined,
  });
  if (r.code !== 0) throw new Error("graphify failed: " + String(r.stderr).slice(-300));
  const raw = await readFile(join(repoDir, "graphify-out", "graph.json"), "utf8");
  return JSON.parse(raw);
}

/** Reduce a (possibly huge) graph to a renderable top-N overview by degree.
 *  The full graph stays cached server-side for query-focused subgraphs later;
 *  the browser can't render tens of thousands of nodes (force-graph dies). */
export function capGraph(data, limit = 600) {
  const total = data.nodes.length;
  if (total <= limit) {
    return { ...data, capped: false, totalNodes: total, totalLinks: data.links.length };
  }
  const ranked = [...data.nodes].sort((a, b) => (b.inDeg + b.outDeg) - (a.inDeg + a.outDeg)).slice(0, limit);
  const keep = new Set(ranked.map((n) => n.id));
  const links = data.links.filter((l) => keep.has(l.source) && keep.has(l.target));
  return {
    nodes: ranked, links, orphans: [], hubs: data.hubs,
    parsedCount: data.parsedCount, skippedCount: data.skippedCount,
    communities: data.communities, engine: data.engine,
    capped: true, totalNodes: total, totalLinks: data.links.length,
  };
}

/** Extract a focused subgraph from the full graph around a set of file paths.
 *  depth=0: only symbols whose sourceFile is in filePaths. depth=N: expand N
 *  hops through links. Returns a valid GraphData the frontend can render as-is.
 *  The full graph stays intact for subsequent queries.
 *
 *  filePaths should be repo-relative (from graphrag's relevantFiles / sources).
 *  Each graph node's sourceFile is also repo-relative — match against the raw
 *  path or trailing segments, since graphify stores different path forms. */
function subgraphFromSeeds(graph, seed, depth) {
  if (!seed.size) return null;
  const adj = new Map(); // nodeId → Set<neighbor id>
  for (const l of graph.links) {
    if (!adj.has(l.source)) adj.set(l.source, new Set());
    if (!adj.has(l.target)) adj.set(l.target, new Set());
    adj.get(l.source).add(l.target);
    adj.get(l.target).add(l.source);
  }
  let frontier = new Set(seed);
  for (let d = 0; d < depth; d++) {
    const next = new Set();
    for (const id of frontier) {
      const nb = adj.get(id);
      if (nb) nb.forEach((n) => { if (!seed.has(n)) next.add(n); });
    }
    next.forEach((n) => seed.add(n));
    frontier = next;
    if (!frontier.size) break;
  }
  const keep = seed;
  const nodes = graph.nodes.filter((n) => keep.has(n.id));
  const links = graph.links.filter((l) => keep.has(l.source) && keep.has(l.target));
  const inDeg = new Map();
  for (const l of links) inDeg.set(l.target, (inDeg.get(l.target) || 0) + 1);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hubs = [...inDeg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([id, d]) => ({ id: byId.get(id)?.name || id, inDeg: d, file: byId.get(id)?.sourceFile || undefined }));
  return {
    nodes, links, orphans: [], hubs,
    parsedCount: nodes.length, skippedCount: 0,
    communities: new Set(nodes.map((n) => n.group)).size,
    engine: graph.engine,
    capped: false, totalNodes: nodes.length, totalLinks: links.length,
  };
}

export function extractSubgraph(graph, filePaths, depth = 1) {
  if (!graph || !graph.nodes || !filePaths.length) return null;
  const pathSet = new Set(filePaths.map((p) => p.replace(/^\/+/, "")));
  const fileHit = (sf) => {
    if (!sf) return false;
    const s = sf.replace(/^\/+/, "");
    if (pathSet.has(s)) return true;
    // graphify sometimes uses basename, sometimes relative; match final segments
    return [...pathSet].some((p) => s.endsWith(p.replace(/^\.[/\\]?/, "")));
  };
  const seed = new Set(graph.nodes.filter((n) => fileHit(n.sourceFile)).map((n) => n.id));
  return subgraphFromSeeds(graph, seed, depth);
}

// normalize a symbol/node name for matching: strip trailing () and a leading
// path/qualifier, lowercase. "slugify()" → "slugify", "mod.foo" → "foo".
const normSym = (n) => String(n || "").replace(/\(\)\s*$/, "").replace(/^.*[./]/, "").toLowerCase();

/** Subgraph seeded by SYMBOL names (e.g. README usage symbols) instead of files. */
export function extractSubgraphBySymbols(graph, names, depth = 1) {
  if (!graph || !graph.nodes || !names || !names.length) return null;
  const want = new Set(names.map((s) => normSym(s)));
  const seed = new Set(graph.nodes.filter((n) => want.has(normSym(n.name)) || want.has(normSym(n.id))).map((n) => n.id));
  return subgraphFromSeeds(graph, seed, depth);
}

/** A file's defined symbols (functions/classes) from the graph, sorted by line.
 *  graphify emits one node per file (label === basename) plus one per symbol;
 *  we drop the file node and classify the rest. Pure — operates on GraphData. */
export function symbolsForFile(graph, path) {
  if (!graph || !graph.nodes || !path) return [];
  const want = String(path).replace(/^\/+/, "");
  const base = want.split("/").pop();
  const hit = (sf) => {
    if (!sf) return false;
    const s = String(sf).replace(/^\/+/, "");
    return s === want || s.endsWith("/" + want) || want.endsWith("/" + s);
  };
  const out = [];
  for (const n of graph.nodes) {
    if (!hit(n.sourceFile)) continue;
    const raw = String(n.name || "");
    if (raw === base) continue; // the file-level node itself
    const isFn = /\(\)\s*$/.test(raw);
    const name = raw.replace(/\(\)\s*$/, "").trim();
    if (!name) continue;
    const m = /^L(\d+)/.exec(String(n.sourceLocation || ""));
    out.push({
      id: n.id,
      name,
      kind: isFn ? "function" : /^[A-Z]/.test(name) ? "class" : "variable",
      line: m ? Number(m[1]) : null,
      location: n.sourceLocation || null,
    });
  }
  out.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));
  return out;
}

/** NetworkX node-link (graphify) → our GraphData. */
export function toGraphData(json) {
  const rawNodes = json.nodes || [];
  const rawLinks = (json.links || []).filter((l) => l.source && l.target);

  const inDeg = new Map();
  const outDeg = new Map();
  for (const l of rawLinks) {
    outDeg.set(l.source, (outDeg.get(l.source) || 0) + 1);
    inDeg.set(l.target, (inDeg.get(l.target) || 0) + 1);
  }

  const nodes = rawNodes.map((n) => {
    const i = inDeg.get(n.id) || 0;
    const o = outDeg.get(n.id) || 0;
    return {
      id: n.id,
      name: n.label || n.norm_label || n.id,
      group: "c" + (n.community ?? 0),
      val: Math.max(1, i + o),
      inDeg: i,
      outDeg: o,
      sourceFile: n.source_file || null,
      sourceLocation: n.source_location || null,
    };
  });

  const links = rawLinks.map((l) => ({
    source: l.source,
    target: l.target,
    relation: l.relation || "",
    confidence: l.confidence || "",
  }));

  // hubs: most-depended-on nodes, labelled by name
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hubs = [...inDeg.entries()]
    .map(([id, d]) => ({ id, d }))
    .sort((a, b) => b.d - a.d)
    .slice(0, 12)
    .map((h) => ({ id: byId.get(h.id)?.name || h.id, inDeg: h.d, file: byId.get(h.id)?.sourceFile || undefined }));

  const communities = new Set(rawNodes.map((n) => n.community)).size;

  return {
    nodes,
    links,
    orphans: [],
    hubs,
    parsedCount: nodes.length,
    skippedCount: 0,
    communities,
    engine: "graphify",
  };
}
