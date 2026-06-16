"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphData } from "@/lib/types";

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

export default function GraphView({
  data,
  building,
  onOpenFile,
}: {
  data: GraphData | null;
  building: boolean;
  onOpenFile: (path: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [hover, setHover] = useState<string | null>(null);

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

  // Clone so the force engine can mutate freely without touching parent state.
  const graph = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    return {
      nodes: data.nodes.map((n) => ({ ...n })),
      links: data.links.map((l) => ({ ...l })),
    };
  }, [data]);

  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    if (!data) return m;
    for (const l of data.links) {
      if (!m.has(l.source)) m.set(l.source, new Set());
      if (!m.has(l.target)) m.set(l.target, new Set());
      m.get(l.source)!.add(l.target);
      m.get(l.target)!.add(l.source);
    }
    return m;
  }, [data]);

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
            <span>Reading source files & resolving imports…</span>
          </div>
        )}
        {!building && data && data.nodes.length === 0 && (
          <div className="placeholder">
            <div>
              <div className="big">🕸</div>
              No in-repo import edges found.
              <br />
              <span className="dim">(MVP resolves JS/TS &amp; Python relative imports.)</span>
            </div>
          </div>
        )}
        {data && data.nodes.length > 0 && (
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
            onEngineStop={() => fgRef.current?.zoomToFit?.(400, 60)}
            onNodeClick={(n: any) => onOpenFile(n.id)}
            onNodeHover={(n: any) => setHover(n ? n.id : null)}
            linkColor={(l: any) => {
              if (!hover) return "rgba(150,160,180,0.18)";
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
              // labels: show for big nodes or when zoomed in / hovered neighborhood
              if (scale > 2.2 || node.val >= 4 || node.id === hover || (neighbors && neighbors.has(node.id))) {
                const label = node.name;
                ctx.font = `${Math.max(3, 10 / scale + 2)}px var(--mono)`;
                ctx.fillStyle = dim ? "rgba(230,232,238,0.3)" : "#cdd2dc";
                ctx.textAlign = "center";
                ctx.fillText(label, node.x, node.y + r + 8 / scale);
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
        <h4>Graph</h4>
        <div className="stat"><span>Files (nodes)</span><b>{data?.nodes.length ?? 0}</b></div>
        <div className="stat"><span>Imports (edges)</span><b>{data?.links.length ?? 0}</b></div>
        <div className="stat"><span>Parsed</span><b>{data?.parsedCount ?? 0}</b></div>
        {!!data?.skippedCount && (
          <div className="stat"><span>Skipped (cap)</span><b>{data.skippedCount}</b></div>
        )}
        <div className="stat"><span>Orphans</span><b>{data?.orphans.length ?? 0}</b></div>

        <h4>Most imported</h4>
        {data?.hubs.length ? (
          data.hubs.map((h) => (
            <div className="hub" key={h.id} title={h.id} onClick={() => onOpenFile(h.id)}>
              <span className="hub-name">{h.id.split("/").pop()}</span>
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
