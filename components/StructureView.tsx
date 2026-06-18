"use client";

// Structure view (Goal 4): a Finder-like *directory map* of the repo — distinct
// from the Explorer file tree. Folders lead, each annotated with its subtree size
// (N dirs · M files). Later units hang per-file symbols (D2), roles/summaries (D3),
// and drill-down (D4) off this same view.

import { useState } from "react";
import type { FileNode } from "@/lib/types";
import { dirStats, visibleChildren } from "@/lib/tree";

function StructNode({
  node,
  depth,
  expanded,
  toggle,
  showAll,
  onShowAll,
  selected,
  onOpen,
}: {
  node: FileNode;
  depth: number;
  expanded: Set<string>;
  toggle: (path: string) => void;
  showAll: Set<string>;
  onShowAll: (path: string) => void;
  selected: string | null;
  onOpen: (path: string) => void;
}) {
  const pad = 8 + depth * 12;
  if (node.type === "tree") {
    const open = expanded.has(node.path);
    const { dirs, files } = dirStats(node);
    const { shown, more } = visibleChildren(node.children || [], showAll.has(node.path));
    return (
      <>
        <div className="row" style={{ paddingLeft: pad }} onClick={() => toggle(node.path)} title={node.path}>
          <span className="twisty">{open ? "▾" : "▸"}</span>
          <span className="ficon">{open ? "📂" : "📁"}</span>
          <span className="fname">{node.name}</span>
          <span className="dir-meta">
            {dirs > 0 && `${dirs} dir${dirs > 1 ? "s" : ""} · `}
            {files} file{files === 1 ? "" : "s"}
          </span>
        </div>
        {open && (
          <>
            {shown.map((c) => (
              <StructNode
                key={c.path}
                node={c}
                depth={depth + 1}
                expanded={expanded}
                toggle={toggle}
                showAll={showAll}
                onShowAll={onShowAll}
                selected={selected}
                onOpen={onOpen}
              />
            ))}
            {more > 0 && (
              <div
                className="row more-row"
                style={{ paddingLeft: 8 + (depth + 1) * 12 }}
                onClick={() => onShowAll(node.path)}
                title={`Show all ${(node.children || []).length} items`}
              >
                <span className="twisty" />
                <span className="ficon">⋯</span>
                <span className="fname">… {more.toLocaleString()} more (show all)</span>
              </div>
            )}
          </>
        )}
      </>
    );
  }
  return (
    <div
      className={"row" + (selected === node.path ? " selected" : "")}
      style={{ paddingLeft: pad }}
      onClick={() => onOpen(node.path)}
      title={node.path}
    >
      <span className="twisty" />
      <span className="ficon">📄</span>
      <span className="fname">{node.name}</span>
    </div>
  );
}

export default function StructureView({
  tree,
  selected,
  onOpen,
}: {
  tree: FileNode | null;
  selected: string | null;
  onOpen: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const onShowAll = (path: string) => setShowAll((prev) => new Set(prev).add(path));

  if (!tree) {
    return <div className="tree dim" style={{ padding: 14, fontSize: 12 }}>No repository loaded.</div>;
  }
  const top = dirStats(tree);
  return (
    <div className="tree">
      <div className="struct-summary dim">
        {top.dirs} director{top.dirs === 1 ? "y" : "ies"} · {top.files} file{top.files === 1 ? "" : "s"}
      </div>
      {tree.children?.map((c) => (
        <StructNode
          key={c.path}
          node={c}
          depth={0}
          expanded={expanded}
          toggle={toggle}
          showAll={showAll}
          onShowAll={onShowAll}
          selected={selected}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
