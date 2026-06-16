import type { FileNode, TreeEntry } from "./types";

/** Build a nested FileNode tree from the flat git-tree entries. */
export function buildTree(entries: TreeEntry[]): FileNode {
  const root: FileNode = { name: "", path: "", type: "tree", children: [] };
  const dirIndex = new Map<string, FileNode>();
  dirIndex.set("", root);

  function ensureDir(path: string): FileNode {
    const existing = dirIndex.get(path);
    if (existing) return existing;
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const parent = ensureDir(parentPath);
    const node: FileNode = {
      name: path.slice(path.lastIndexOf("/") + 1),
      path,
      type: "tree",
      children: [],
    };
    parent.children!.push(node);
    dirIndex.set(path, node);
    return node;
  }

  // Pre-create dirs (some trees only list blobs).
  for (const e of entries) {
    if (e.type === "tree") ensureDir(e.path);
  }
  for (const e of entries) {
    if (e.type !== "blob") continue;
    const parentPath = e.path.includes("/") ? e.path.slice(0, e.path.lastIndexOf("/")) : "";
    const parent = ensureDir(parentPath);
    parent.children!.push({
      name: e.path.slice(e.path.lastIndexOf("/") + 1),
      path: e.path,
      type: "blob",
      size: e.size,
    });
  }

  sortNode(root);
  return root;
}

// Folders first, then files, both alphabetical (case-insensitive).
function sortNode(node: FileNode) {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  for (const c of node.children) sortNode(c);
}
