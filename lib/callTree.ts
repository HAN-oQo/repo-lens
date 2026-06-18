// Pure call-tree / step-list builder (Goal 6, V2). Turns a GraphData into an
// ordered, numbered, nested tree by following directed links from an entry node.
// Cycles are broken (an edge back to an ancestor becomes a marked leaf, not a
// recursion), and depth/total are capped so a pathological graph can't explode.
// DOM-free → unit-testable; GraphView's "tree" mode renders the result.

import type { GraphData } from "./types";

export interface CallTreeNode {
  id: string;
  name: string;
  sourceFile: string | null;
  depth: number;
  step: number; // 1-based pre-order index (the "step number")
  cycle: boolean; // edge back to an ancestor — shown but not expanded
  children: CallTreeNode[];
}

export interface CallTree {
  tree: CallTreeNode | null;
  count: number; // total rows emitted
  depth: number; // max depth reached
}

const norm = (s: string) => String(s || "").replace(/\(\)\s*$/, "").replace(/^.*[./]/, "").toLowerCase();
const idOf = (e: any) => (typeof e === "object" && e ? e.id : e);

export function toCallTree(
  graph: GraphData | null,
  root?: string,
  opts: { maxDepth?: number; maxNodes?: number } = {}
): CallTree {
  if (!graph || !graph.nodes?.length) return { tree: null, count: 0, depth: 0 };
  const maxDepth = opts.maxDepth ?? 12;
  const maxNodes = opts.maxNodes ?? 500;

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of graph.nodes) { out.set(n.id, []); indeg.set(n.id, 0); }
  for (const l of graph.links) {
    const s = idOf(l.source), t = idOf(l.target);
    if (!byId.has(s) || !byId.has(t)) continue;
    const arr = out.get(s)!;
    if (!arr.includes(t)) arr.push(t);
    indeg.set(t, (indeg.get(t) || 0) + 1);
  }

  // choose the entry: explicit root (by id or normalized name) → else a source
  // node (in-degree 0) with the most callees → else the node with the most callees.
  let rootId: string | undefined;
  if (root) {
    const want = norm(root);
    rootId = graph.nodes.find((n) => n.id === root || norm(n.name) === want || norm(n.id) === want)?.id;
  }
  if (!rootId) {
    const ranked = [...graph.nodes].sort((a, b) => {
      const ea = (indeg.get(a.id) || 0) === 0 ? 1 : 0;
      const eb = (indeg.get(b.id) || 0) === 0 ? 1 : 0;
      if (ea !== eb) return eb - ea;
      return out.get(b.id)!.length - out.get(a.id)!.length;
    });
    rootId = ranked[0]?.id;
  }
  if (!rootId) return { tree: null, count: 0, depth: 0 };

  let count = 0, maxSeenDepth = 0, step = 0;
  const make = (id: string, depth: number, cycle: boolean): CallTreeNode => {
    const n = byId.get(id);
    step++; count++;
    maxSeenDepth = Math.max(maxSeenDepth, depth);
    return { id, name: n?.name || id, sourceFile: n?.sourceFile || null, depth, step, cycle, children: [] };
  };
  const build = (id: string, depth: number, path: Set<string>): CallTreeNode => {
    const node = make(id, depth, false);
    if (depth >= maxDepth || count >= maxNodes) return node;
    const nextPath = new Set(path).add(id);
    for (const t of out.get(id) || []) {
      if (count >= maxNodes) break;
      if (path.has(t) || t === id) node.children.push(make(t, depth + 1, true)); // ancestor → cycle leaf
      else node.children.push(build(t, depth + 1, nextPath));
    }
    return node;
  };
  return { tree: build(rootId, 0, new Set()), count, depth: maxSeenDepth };
}

/** Flatten a call tree to ordered rows (pre-order) for list rendering. */
export function flattenCallTree(root: CallTreeNode | null): CallTreeNode[] {
  const rows: CallTreeNode[] = [];
  const walk = (n: CallTreeNode) => { rows.push(n); n.children.forEach(walk); };
  if (root) walk(root);
  return rows;
}
