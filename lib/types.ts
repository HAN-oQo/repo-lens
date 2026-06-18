// Shared types for Repo Lens.

export interface RepoRef {
  owner: string;
  repo: string;
  branch: string;
}

/** A flat entry from the GitHub git-tree API. */
export interface TreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha: string;
}

export interface RepoMeta {
  defaultBranch: string;
  description: string | null;
  language: string | null;
  stars: number;
  private: boolean;
}

/** Nested tree node for the Explorer. */
export interface FileNode {
  name: string;
  path: string;
  type: "blob" | "tree";
  size?: number;
  children?: FileNode[];
}

export interface GraphNode {
  id: string; // file path (v1) or graphify node id (v2)
  name: string; // basename / symbol label
  group: string; // top-level dir (v1) or community (v2) — for coloring
  val: number; // degree (for sizing)
  inDeg: number;
  outDeg: number;
  sourceFile?: string; // graphify: file to open on click
  sourceLocation?: string; // graphify: e.g. "L42"
}

export interface GraphLink {
  source: string;
  target: string;
  relation?: string; // graphify: calls | imports | contains | ...
  confidence?: string; // graphify: EXTRACTED | INFERRED | AMBIGUOUS
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  /** files we parsed but whose imports resolved to nothing in-repo */
  orphans: string[];
  /** most-imported files/symbols */
  hubs: { id: string; inDeg: number; file?: string }[];
  parsedCount: number;
  skippedCount: number;
  communities?: number;
  engine?: string;
  /** true when the server sent only a top-N overview of a larger graph */
  capped?: boolean;
  totalNodes?: number;
  totalLinks?: number;
}

export type TabKind = "readme" | "file" | "graph";
/** which graph a graph-tab shows: the full overview, the README usage flow, or a query subgraph */
export type GraphTabView = "overview" | "quickstart" | "query";

export interface Tab {
  kind: TabKind;
  /** path for file tabs; "__README__" / graph-tab ids for specials */
  id: string;
  title: string;
  view?: GraphTabView; // graph tabs only
}

export type LeftView = "explorer" | "search" | "graph";
