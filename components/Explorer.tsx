"use client";

import { useState } from "react";
import type { FileNode } from "@/lib/types";
import { ext } from "@/lib/lang";

function fileIcon(name: string): string {
  const e = ext(name);
  const base = name.toLowerCase();
  if (base === "dockerfile") return "🐳";
  if (/^readme/i.test(name)) return "📖";
  if (base === "package.json") return "📦";
  if (base.endsWith(".lock") || base === "package-lock.json") return "🔒";
  const map: Record<string, string> = {
    ts: "🔷", tsx: "🔷", mts: "🔷", cts: "🔷",
    js: "🟨", jsx: "🟨", mjs: "🟨", cjs: "🟨",
    py: "🐍", pyi: "🐍",
    go: "🐹", rs: "🦀", rb: "💎", php: "🐘", java: "☕", kt: "🟪",
    c: "🔵", h: "🔵", cpp: "🔵", cc: "🔵", hpp: "🔵", cs: "🟩", swift: "🐦",
    md: "📝", markdown: "📝", rst: "📝", txt: "📄",
    json: "🗂️", yml: "⚙️", yaml: "⚙️", toml: "⚙️", ini: "⚙️", cfg: "⚙️",
    html: "🌐", htm: "🌐", css: "🎨", scss: "🎨", less: "🎨",
    sh: "🖥️", bash: "🖥️", sql: "🗄️",
    png: "🖼️", jpg: "🖼️", jpeg: "🖼️", gif: "🖼️", svg: "🖼️", ico: "🖼️", webp: "🖼️",
  };
  return map[e] || "📄";
}

function Node({
  node,
  depth,
  expanded,
  toggle,
  selected,
  onOpen,
}: {
  node: FileNode;
  depth: number;
  expanded: Set<string>;
  toggle: (path: string) => void;
  selected: string | null;
  onOpen: (path: string) => void;
}) {
  const pad = 8 + depth * 12;
  if (node.type === "tree") {
    const open = expanded.has(node.path);
    return (
      <>
        <div className="row" style={{ paddingLeft: pad }} onClick={() => toggle(node.path)}>
          <span className="twisty">{open ? "▾" : "▸"}</span>
          <span className="ficon">{open ? "📂" : "📁"}</span>
          <span className="fname">{node.name}</span>
        </div>
        {open &&
          node.children?.map((c) => (
            <Node
              key={c.path}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              selected={selected}
              onOpen={onOpen}
            />
          ))}
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
      <span className="ficon">{fileIcon(node.name)}</span>
      <span className="fname">{node.name}</span>
    </div>
  );
}

export default function Explorer({
  tree,
  selected,
  onOpen,
}: {
  tree: FileNode | null;
  selected: string | null;
  onOpen: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  if (!tree) {
    return <div className="tree dim" style={{ padding: 14, fontSize: 12 }}>No repository loaded.</div>;
  }
  return (
    <div className="tree">
      {tree.children?.map((c) => (
        <Node
          key={c.path}
          node={c}
          depth={0}
          expanded={expanded}
          toggle={toggle}
          selected={selected}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
