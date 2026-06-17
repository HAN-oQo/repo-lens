// graphify integration: build a code-only symbol graph (no LLM) and adapt its
// graph.json (NetworkX node-link) to our GraphData shape.
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { run } from "./util.mjs";

export async function graphifyAvailable() {
  const r = await run("graphify", ["--version"], { timeout: 10000 });
  return r.code === 0;
}

/** `graphify update` re-extracts code files with NO LLM — free, local, fast. */
export async function buildGraphJson(repoDir) {
  const r = await run("graphify", ["update", "."], { cwd: repoDir, timeout: 900000, maxBuffer: 8 * 1024 * 1024 });
  if (r.code !== 0) throw new Error("graphify failed: " + String(r.stderr).slice(-300));
  const raw = await readFile(join(repoDir, "graphify-out", "graph.json"), "utf8");
  return JSON.parse(raw);
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
