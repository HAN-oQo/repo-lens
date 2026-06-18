"use client";

// Structure view (Goal 4): a Finder-like *directory map* of the repo — distinct
// from the Explorer file tree. Folders lead, each annotated with its subtree size.
// D4 adds drill-down: expanding a dir/file lazily fetches a one-line ROLE summary
// (/api/summary) and, for files, the list of functions/classes (/api/fileinfo);
// expanding a function fetches that function's role. LLM summaries are fetched
// lazily (only on expand) to stay cheap.

import { useState } from "react";
import type { FileNode, RepoRef } from "@/lib/types";
import { dirStats, visibleChildren } from "@/lib/tree";
import { apiFileInfo, apiSummary, type FileSymbol } from "@/lib/api";

// One inline-rendered role line (dim, italic) shown beneath/after a node.
function Role({ text, loading }: { text?: string; loading?: boolean }) {
  if (!text && !loading) return null;
  return (
    <span className="struct-role" style={{ marginLeft: 8, fontStyle: "italic", opacity: 0.6, fontSize: 11 }}>
      {loading && !text ? "…" : text}
    </span>
  );
}

function StructNode({
  node,
  depth,
  ctx,
}: {
  node: FileNode;
  depth: number;
  ctx: Ctx;
}) {
  const pad = 8 + depth * 12;
  const { expanded, toggleDir, showAll, onShowAll, selected, onOpen, repo, roles, roleLoading, ensureRole } = ctx;

  if (node.type === "tree") {
    const open = expanded.has(node.path);
    const { dirs, files } = dirStats(node);
    const { shown, more } = visibleChildren(node.children || [], showAll.has(node.path));
    return (
      <>
        <div
          className="row"
          style={{ paddingLeft: pad }}
          onClick={() => { toggleDir(node.path); if (repo) ensureRole(node.path); }}
          title={node.path}
        >
          <span className="twisty">{open ? "▾" : "▸"}</span>
          <span className="ficon">{open ? "📂" : "📁"}</span>
          <span className="fname">{node.name}</span>
          <span className="dir-meta">
            {dirs > 0 && `${dirs} dir${dirs > 1 ? "s" : ""} · `}
            {files} file{files === 1 ? "" : "s"}
          </span>
          <Role text={roles[node.path]} loading={roleLoading.has(node.path)} />
        </div>
        {open && (
          <>
            {shown.map((c) => (
              <StructNode key={c.path} node={c} depth={depth + 1} ctx={ctx} />
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

  // file: now expandable into its functions/classes (D4)
  return <FileNodeRow node={node} pad={pad} depth={depth} ctx={ctx} />;
}

function FileNodeRow({ node, pad, depth, ctx }: { node: FileNode; pad: number; depth: number; ctx: Ctx }) {
  const { selected, onOpen, repo, roles, roleLoading, ensureRole, symbols, ensureSymbols } = ctx;
  const [open, setOpen] = useState(false);
  const syms = symbols[node.path];

  const expand = () => {
    const next = !open;
    setOpen(next);
    if (next && repo) { ensureSymbols(node.path); ensureRole(node.path); }
  };

  return (
    <>
      <div className={"row" + (selected === node.path ? " selected" : "")} style={{ paddingLeft: pad }} title={node.path}>
        <span
          className="twisty"
          style={{ cursor: "pointer" }}
          onClick={(e) => { e.stopPropagation(); expand(); }}
        >
          {repo ? (open ? "▾" : "▸") : ""}
        </span>
        <span className="ficon" onClick={() => onOpen(node.path)} style={{ cursor: "pointer" }}>📄</span>
        <span className="fname" onClick={() => onOpen(node.path)} style={{ cursor: "pointer" }}>{node.name}</span>
        <Role text={roles[node.path]} loading={roleLoading.has(node.path)} />
      </div>
      {open && syms && syms.map((s) => (
        <SymbolRow key={s.id} sym={s} file={node.path} pad={8 + (depth + 1) * 12} ctx={ctx} />
      ))}
      {open && syms && syms.length === 0 && (
        <div className="row dim" style={{ paddingLeft: 8 + (depth + 1) * 12, fontSize: 11 }}>
          <span className="twisty" /><span className="ficon" />no indexed symbols
        </div>
      )}
    </>
  );
}

const KIND_ICON: Record<string, string> = { function: "ƒ", class: "🅒", variable: "▪" };

function SymbolRow({ sym, file, pad, ctx }: { sym: FileSymbol; file: string; pad: number; ctx: Ctx }) {
  const { onOpen, roles, roleLoading, ensureRole } = ctx;
  const [open, setOpen] = useState(false);
  const key = `${file}#${sym.name}`;
  const expand = () => {
    const next = !open;
    setOpen(next);
    if (next) ensureRole(file, sym.name);
  };
  return (
    <div className="row" style={{ paddingLeft: pad }} title={`${sym.name}${sym.location ? " · " + sym.location : ""}`}>
      <span className="twisty" style={{ cursor: "pointer" }} onClick={expand}>{open ? "▾" : "▸"}</span>
      <span className="ficon" style={{ fontStyle: "italic" }}>{KIND_ICON[sym.kind] || "ƒ"}</span>
      <span className="fname" onClick={() => onOpen(file)} style={{ cursor: "pointer" }}>{sym.name}</span>
      {sym.line != null && <span className="dir-meta">:{sym.line}</span>}
      <Role text={roles[key]} loading={roleLoading.has(key)} />
    </div>
  );
}

interface Ctx {
  expanded: Set<string>;
  toggleDir: (path: string) => void;
  showAll: Set<string>;
  onShowAll: (path: string) => void;
  selected: string | null;
  onOpen: (path: string) => void;
  repo: RepoRef | null;
  roles: Record<string, string>;
  roleLoading: Set<string>;
  ensureRole: (path: string, symbol?: string) => void;
  symbols: Record<string, FileSymbol[]>;
  ensureSymbols: (path: string) => void;
}

export default function StructureView({
  tree,
  selected,
  onOpen,
  repo = null,
}: {
  tree: FileNode | null;
  selected: string | null;
  onOpen: (path: string) => void;
  repo?: RepoRef | null;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [roleLoading, setRoleLoading] = useState<Set<string>>(new Set());
  const [symbols, setSymbols] = useState<Record<string, FileSymbol[]>>({});

  const toggleDir = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const onShowAll = (path: string) => setShowAll((prev) => new Set(prev).add(path));

  // lazily fetch a one-line role for a dir/file (symbol omitted) or function (symbol set)
  const ensureRole = (path: string, symbol?: string) => {
    if (!repo) return;
    const key = symbol ? `${path}#${symbol}` : path;
    setRoles((prev) => {
      if (prev[key] !== undefined) return prev; // already fetched
      setRoleLoading((l) => new Set(l).add(key));
      apiSummary(repo, path, symbol).then((r) => {
        setRoles((p) => ({ ...p, [key]: r.summary || "" }));
        setRoleLoading((l) => { const n = new Set(l); n.delete(key); return n; });
      });
      return prev;
    });
  };

  const ensureSymbols = (path: string) => {
    if (!repo) return;
    setSymbols((prev) => {
      if (prev[path] !== undefined) return prev;
      apiFileInfo(repo, path).then((r) => setSymbols((p) => ({ ...p, [path]: r.symbols || [] })));
      return prev;
    });
  };

  if (!tree) {
    return <div className="tree dim" style={{ padding: 14, fontSize: 12 }}>No repository loaded.</div>;
  }
  const top = dirStats(tree);
  const ctx: Ctx = { expanded, toggleDir, showAll, onShowAll, selected, onOpen, repo, roles, roleLoading, ensureRole, symbols, ensureSymbols };
  return (
    <div className="tree">
      <div className="struct-summary dim">
        {top.dirs} director{top.dirs === 1 ? "y" : "ies"} · {top.files} file{top.files === 1 ? "" : "s"}
        {repo && <span style={{ marginLeft: 6 }}>· expand for roles</span>}
      </div>
      {tree.children?.map((c) => (
        <StructNode key={c.path} node={c} depth={0} ctx={ctx} />
      ))}
    </div>
  );
}
