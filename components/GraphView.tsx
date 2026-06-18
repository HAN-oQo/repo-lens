"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphData, RepoRef } from "@/lib/types";
import { apiActivity, hasBackend } from "@/lib/api";
import { type GraphMode, modeConfig, resolveMode } from "@/lib/graphModes";
import { toCallTree, flattenCallTree } from "@/lib/callTree";

// cast to any: next/dynamic + the lib's prop types are awkward together, and we
// pass canvas-callback props that don't need compile-time checking here.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false }) as any;

const PALETTE = [
  "#85b7eb", "#97c459", "#e6b54f", "#ef9f86", "#bfa0eb",
  "#7fd1c0", "#e58fb8", "#f0c674", "#9db4e2", "#c2b280",
];

function colorFor(group: string, groups: string[]): string {
  const i = groups.indexOf(group);
  return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length] || "#85b7eb";
}

// Call-tree / step-list renderer (V2): ordered, numbered, indented steps from the
// entry node via the pure toCallTree(). Click a row → open its source file.
function CallTreeView({ data, onOpenFile }: { data: GraphData; onOpenFile: (p: string) => void }) {
  const { tree, count, depth } = useMemo(() => toCallTree(data), [data]);
  const rows = useMemo(() => flattenCallTree(tree), [tree]);
  if (!tree) {
    return <div className="graph-modestub" style={{ position: "absolute", inset: 0, padding: 16, color: "#cfd4df", fontSize: 12 }}>No directed flow to lay out as a call tree.</div>;
  }
  return (
    <div className="call-tree" style={{ position: "absolute", inset: 0, overflow: "auto", padding: 14, color: "#cfd4df", fontSize: 12, fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}>
      <div className="dim" style={{ marginBottom: 8, fontFamily: "system-ui, sans-serif" }}>
        Call tree from <b>{tree.name}</b> · {count} step{count === 1 ? "" : "s"} · depth {depth}
      </div>
      {rows.map((n) => (
        <div
          key={n.step + ":" + n.id}
          className="ct-row"
          style={{ paddingLeft: 6 + n.depth * 16, cursor: "pointer", padding: "2px 0", opacity: n.cycle ? 0.6 : 1 }}
          onClick={() => onOpenFile(n.sourceFile || n.id)}
          title={n.sourceFile || n.id}
        >
          <span className="ct-step" style={{ opacity: 0.5, marginRight: 6 }}>{n.step}.</span>
          {n.cycle && <span title="cycle — already visited" style={{ marginRight: 3 }}>↩</span>}
          {n.name}
        </div>
      ))}
    </div>
  );
}

// Placeholder renderer for the mermaid mode — lists nodes so the mode renders
// without error today; V3 replaces this with a real flowchart.
function ModeStub({ kind, data, onOpenFile }: { kind: "mermaid"; data: GraphData; onOpenFile: (p: string) => void }) {
  return (
    <div className="graph-modestub" style={{ position: "absolute", inset: 0, overflow: "auto", padding: 16, color: "#cfd4df", fontSize: 12 }}>
      <div className="dim" style={{ marginBottom: 8 }}>Flowchart view · {data.nodes.length} symbols (preview)</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {data.nodes.slice(0, 200).map((n) => (
          <li key={n.id} onClick={() => onOpenFile(n.sourceFile || n.id)} style={{ cursor: "pointer", padding: "2px 0", fontFamily: "ui-monospace, Menlo, Consolas, monospace" }} title={n.sourceFile || n.id}>
            ▸ {n.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function GraphView({
  data,
  building,
  onOpenFile,
  repo,
  fileCount,
  focusGraph,
  focusLabel,
  onClearFocus,
  mode,
}: {
  data: GraphData | null;
  building: boolean;
  onOpenFile: (path: string) => void;
  repo?: RepoRef | null;
  fileCount?: number;
  focusGraph?: GraphData | null;
  focusLabel?: string;
  onClearFocus?: () => void;
  mode?: GraphMode | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [hover, setHover] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState<string[]>([]);

  // While building: tick an elapsed timer and stream the backend activity log so
  // the overlay shows real progress (clone/scan/graphify lines), not just a spinner.
  useEffect(() => {
    if (!building) { setElapsed(0); setProgress([]); return; }
    const t0 = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    let since = 0, stop = false, poll: ReturnType<typeof setInterval> | null = null;
    if (hasBackend) {
      const tick = async () => {
        const { lines, lastId } = await apiActivity(since, repo || undefined);
        if (stop || !lines.length) return;
        since = lastId;
        setProgress((prev) => [...prev, ...lines.map((l) => l.msg)].slice(-6));
      };
      tick();
      poll = setInterval(tick, 1200);
    }
    return () => { stop = true; clearInterval(timer); if (poll) clearInterval(poll); };
  }, [building, repo]);

  // rough ETA hint by repo size (first build; cached builds are instant)
  const etaHint = fileCount
    ? fileCount > 1500 ? "large repo — first build can take 1–3 min" : fileCount > 400 ? "usually ~20–60s" : "usually a few seconds"
    : "";

  useEffect(() => {
    const elm = wrapRef.current;
    if (!elm) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: elm.clientWidth, h: elm.clientHeight });
    });
    ro.observe(elm);
    setSize({ w: elm.clientWidth, h: elm.clientHeight });
    return () => ro.disconnect();
  }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.nodes.map((n) => n.group))).sort();
  }, [data]);

  // When focusGraph is active, render that instead of the overview. Clone
  // so the force engine can mutate freely without touching parent state.
  const activeData = focusGraph || data;
  const isFocus = !!focusGraph; // focus/usage-flow view: small + DAG → always label, readably
  // V1: pick the render mode. No explicit mode → focus=DAG, overview=force (prior behavior).
  const cfg = modeConfig(resolveMode(mode, isFocus));
  const graph = useMemo(() => {
    if (!activeData) return { nodes: [], links: [] };
    return {
      nodes: activeData.nodes.map((n) => ({ ...n })),
      links: activeData.links.map((l) => ({ ...l })),
    };
  }, [activeData]);

  // Auto-zoom when the focus graph changes (new subgraph → zoom to fit)
  useEffect(() => {
    if (!fgRef.current || !focusGraph || focusGraph.nodes.length === 0) return;
    const t = setTimeout(() => fgRef.current?.zoomToFit?.(600, 80), 500);
    return () => clearTimeout(t);
  }, [focusGraph]);

  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    if (!activeData) return m;
    for (const l of activeData.links) {
      if (!m.has(l.source)) m.set(l.source, new Set());
      if (!m.has(l.target)) m.set(l.target, new Set());
      m.get(l.source)!.add(l.target);
      m.get(l.target)!.add(l.source);
    }
    return m;
  }, [activeData]);

  const neighbors = hover ? adjacency.get(hover) : null;

  function nodeId(n: any): string {
    return typeof n === "object" ? n.id : n;
  }

  return (
    <div className="graph-wrap">
      <div className="graph-canvas" ref={wrapRef}>
        {building && (
          <div className="graph-loading">
            <span className="spin" />
            <div className="gl-title">
              Building the symbol graph… <b>{elapsed}s</b>
              {etaHint && <span className="gl-eta"> · {etaHint}</span>}
            </div>
            {progress.length > 0 && (
              <div className="gl-log">
                {progress.map((m, i) => (
                  <div key={i} className={i === progress.length - 1 ? "gl-cur" : ""}>{m}</div>
                ))}
              </div>
            )}
          </div>
        )}
        {focusGraph && !building && (
          <div className="graph-focus-notice">
            <span>🔍 {focusLabel || "From your question"} · <b>{focusGraph.nodes.length}</b> symbols — zoomed to relevance.</span>
            <button className="gf-btn" onClick={onClearFocus}>Full overview</button>
          </div>
        )}
        {!building && activeData && activeData.nodes.length === 0 && (
          <div className="placeholder">
            <div>
              <div className="big">🕸</div>
              No in-repo import edges found.
              <br />
              <span className="dim">(MVP resolves JS/TS &amp; Python relative imports.)</span>
            </div>
          </div>
        )}
        {activeData && activeData.nodes.length > 0 && cfg.renderer === "tree" && (
          <CallTreeView data={activeData} onOpenFile={onOpenFile} />
        )}
        {activeData && activeData.nodes.length > 0 && cfg.renderer === "mermaid" && (
          <ModeStub kind="mermaid" data={activeData} onOpenFile={onOpenFile} />
        )}
        {activeData && activeData.nodes.length > 0 && cfg.renderer === "force" && (
          <ForceGraph2D
            ref={fgRef as any}
            graphData={graph as any}
            width={size.w}
            height={size.h}
            backgroundColor="#1e2330"
            nodeRelSize={4}
            nodeVal={(n: any) => n.val}
            nodeLabel={(n: any) => `${n.id}  ·  in ${n.inDeg} / out ${n.outDeg}`}
            cooldownTicks={120}
            dagMode={cfg.dag ? "lr" : undefined}
            dagLevelDistance={110}
            onDagError={() => {}}
            onEngineStop={() => fgRef.current?.zoomToFit?.(400, 60)}
            onNodeClick={(n: any) => onOpenFile(n.sourceFile || n.id)}
            onNodeHover={(n: any) => setHover(n ? n.id : null)}
            linkColor={(l: any) => {
              const structural = l.relation === "contains";
              if (!hover) return structural ? "rgba(150,160,180,0.07)" : "rgba(133,183,235,0.30)";
              const s = nodeId(l.source), t = nodeId(l.target);
              return s === hover || t === hover ? "#4a9eff" : "rgba(150,160,180,0.05)";
            }}
            linkWidth={(l: any) => {
              if (!hover) return 1;
              const s = nodeId(l.source), t = nodeId(l.target);
              return s === hover || t === hover ? 2 : 0.5;
            }}
            linkDirectionalArrowLength={3}
            linkDirectionalArrowRelPos={1}
            nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, scale: number) => {
              const r = Math.max(2, Math.sqrt(node.val) * 2.5);
              const dim = hover && node.id !== hover && !(neighbors && neighbors.has(node.id));
              ctx.globalAlpha = dim ? 0.18 : 1;
              ctx.beginPath();
              ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
              ctx.fillStyle = colorFor(node.group, groups);
              ctx.fill();
              if (node.id === hover) {
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = "#fff";
                ctx.stroke();
              }
              // labels: always in the focus/flow view (it's small), else only big/zoomed/hovered.
              // Drawn with a background pill + constant screen-size font so they don't get
              // lost behind nodes/edges.
              const show = isFocus || scale > 1.8 || node.val >= 4 || node.id === hover || (neighbors && neighbors.has(node.id));
              const label = String(node.name || "");
              if (show && label) {
                const fontSize = Math.max(3, 11 / scale); // ~constant ~11px on screen
                ctx.font = `${fontSize}px ui-monospace, Menlo, Consolas, monospace`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                const tw = ctx.measureText(label).width;
                const padX = fontSize * 0.4;
                const ly = node.y + r + fontSize * 1.1; // below the node
                ctx.globalAlpha = dim ? 0.25 : 0.95;
                ctx.fillStyle = "rgba(18,21,28,0.85)"; // pill behind text
                ctx.fillRect(node.x - tw / 2 - padX, ly - fontSize * 0.6, tw + padX * 2, fontSize * 1.2);
                ctx.globalAlpha = dim ? 0.4 : 1;
                ctx.fillStyle = "#e6e8ee";
                ctx.fillText(label, node.x, ly);
                ctx.textBaseline = "alphabetic";
              }
              ctx.globalAlpha = 1;
            }}
            nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
              const r = Math.max(4, Math.sqrt(node.val) * 2.5 + 2);
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
              ctx.fill();
            }}
          />
        )}
      </div>

      <div className="graph-side">
        {data?.capped && (
          <div className="graph-capped">
            Showing the <b>{data.nodes.length}</b> most-connected of{" "}
            <b>{data.totalNodes?.toLocaleString()}</b> symbols (overview).
            <br />Ask a question to focus on a specific flow.
          </div>
        )}
        <h4>Graph</h4>
        <div className="stat"><span>{data?.capped ? "Shown / total nodes" : "Files (nodes)"}</span><b>{data?.capped ? `${data.nodes.length} / ${data.totalNodes?.toLocaleString()}` : (data?.nodes.length ?? 0)}</b></div>
        <div className="stat"><span>Imports (edges)</span><b>{data?.capped ? `${data.links.length} / ${data.totalLinks?.toLocaleString()}` : (data?.links.length ?? 0)}</b></div>
        <div className="stat"><span>Parsed</span><b>{data?.parsedCount ?? 0}</b></div>
        {!!data?.skippedCount && (
          <div className="stat"><span>Skipped (cap)</span><b>{data.skippedCount}</b></div>
        )}
        <div className="stat"><span>Orphans</span><b>{data?.orphans.length ?? 0}</b></div>

        <h4>Most imported</h4>
        {data?.hubs.length ? (
          data.hubs.map((h, i) => (
            <div className="hub" key={h.id + i} title={h.file || h.id} onClick={() => onOpenFile(h.file || h.id)}>
              <span className="hub-name">{(h.id.split("/").pop()) || h.id}</span>
              <span className="hub-deg">{h.inDeg}</span>
            </div>
          ))
        ) : (
          <div className="dim">—</div>
        )}

        <h4>Folders</h4>
        {groups.map((g) => (
          <div className="legend-item" key={g}>
            <span className="legend-dot" style={{ background: colorFor(g, groups) }} />
            <span className="hub-name">{g}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
