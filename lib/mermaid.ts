// Pure Mermaid flowchart builder (Goal 6, V3). GraphData → a `flowchart LR`
// string with sanitized node ids (real names kept as quoted labels) and directed
// edges. DOM-free so it's unit-testable; the MermaidView component renders the
// string (mermaid needs a browser) and wires node clicks back to source files.

import type { GraphData } from "./types";

// mermaid labels are quoted; escape the quote, flatten newlines, cap length.
const escLabel = (s: string) => String(s || "").replace(/"/g, "&quot;").replace(/[\n\r]+/g, " ").slice(0, 60);

// a mermaid-safe node id (alnum/underscore, not starting with a digit), deduped.
function makeSafeId(name: string, used: Set<string>): string {
  let base = String(name || "n").replace(/\(\)/g, "").replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
  if (!base) base = "n";
  if (/^[0-9]/.test(base)) base = "n" + base;
  let id = base, i = 2;
  while (used.has(id)) id = `${base}_${i++}`;
  used.add(id);
  return id;
}

export interface MermaidNode { safeId: string; id: string; name: string; sourceFile: string | null; }
export interface MermaidBuild { code: string; nodes: MermaidNode[]; edges: number; }

const idOf = (e: any) => (typeof e === "object" && e ? e.id : e);

/** Build a `flowchart LR` plus the safeId→node map (for click→open wiring). */
export function buildMermaid(graph: GraphData | null, opts: { maxNodes?: number } = {}): MermaidBuild {
  if (!graph || !graph.nodes?.length) return { code: "flowchart LR\n", nodes: [], edges: 0 };
  const maxNodes = opts.maxNodes ?? 300;
  const used = new Set<string>();
  const idToSafe = new Map<string, string>();
  const nodes: MermaidNode[] = [];
  for (const n of graph.nodes.slice(0, maxNodes)) {
    const safeId = makeSafeId(n.name || n.id, used);
    idToSafe.set(n.id, safeId);
    nodes.push({ safeId, id: n.id, name: n.name || n.id, sourceFile: n.sourceFile || null });
  }
  const lines = ["flowchart LR"];
  for (const o of nodes) lines.push(`  ${o.safeId}["${escLabel(o.name)}"]`);
  let edges = 0;
  for (const l of graph.links) {
    const ss = idToSafe.get(idOf(l.source)), ts = idToSafe.get(idOf(l.target));
    if (!ss || !ts) continue;
    lines.push(`  ${ss} --> ${ts}`);
    edges++;
  }
  return { code: lines.join("\n") + "\n", nodes, edges };
}

/** Just the flowchart string. */
export function toMermaid(graph: GraphData | null, opts?: { maxNodes?: number }): string {
  return buildMermaid(graph, opts).code;
}
