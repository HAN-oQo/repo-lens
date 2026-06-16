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
  id: string; // file path
  name: string; // basename
  group: string; // top-level dir (for coloring)
  val: number; // degree (for sizing)
  inDeg: number;
  outDeg: number;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  /** files we parsed but whose imports resolved to nothing in-repo */
  orphans: string[];
  /** most-imported files (id, inDeg) */
  hubs: { id: string; inDeg: number }[];
  parsedCount: number;
  skippedCount: number;
}

export type TabKind = "readme" | "file" | "graph";

export interface Tab {
  kind: TabKind;
  /** path for file tabs; "__README__" / "__GRAPH__" for specials */
  id: string;
  title: string;
}

export type LeftView = "explorer" | "search" | "graph";
