// Pluggable graph visualization modes (Goal 6). The graph area can render a
// GraphData in one of several modes; this pure module is the registry that maps a
// mode → which renderer draws it and how. GraphView dispatches on modeConfig();
// the left rail (V4) picks the mode. Kept DOM-free so it's unit-testable.

export type GraphMode = "force" | "dag" | "tree" | "mermaid";

export const GRAPH_MODES: GraphMode[] = ["force", "dag", "tree", "mermaid"];

export interface ModeConfig {
  mode: GraphMode;
  renderer: "force" | "tree" | "mermaid"; // which component draws it (force covers force+dag)
  dag: boolean; // force renderer only: lay out left→right as a DAG
  label: string;
  icon: string;
}

const CONFIG: Record<GraphMode, ModeConfig> = {
  force: { mode: "force", renderer: "force", dag: false, label: "Force graph", icon: "🕸" },
  dag: { mode: "dag", renderer: "force", dag: true, label: "DAG flow", icon: "→" },
  tree: { mode: "tree", renderer: "tree", dag: false, label: "Call tree", icon: "≣" },
  mermaid: { mode: "mermaid", renderer: "mermaid", dag: false, label: "Flowchart", icon: "⤳" },
};

/** The render config for a mode (falls back to force for an unknown mode). */
export function modeConfig(mode: GraphMode): ModeConfig {
  return CONFIG[mode] || CONFIG.force;
}

/** Fold the pre-V1 behavior in: with no explicit mode, a focus/usage-flow graph
 *  lays out as a DAG and the overview stays a force graph. An explicit (valid)
 *  mode always wins. */
export function resolveMode(mode: GraphMode | undefined | null, isFocus: boolean): GraphMode {
  if (mode && GRAPH_MODES.includes(mode)) return mode;
  return isFocus ? "dag" : "force";
}
