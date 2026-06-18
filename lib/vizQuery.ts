// Parse a natural-language Ask question for a requested visualization (Goal 6, V6).
// "show the request flow as a flowchart" → mermaid; "as a call tree" → tree;
// "as a dag" → dag; "force graph" → force. Returns viz=null when none is named
// (the caller defaults query tabs to "dag"). Pure → unit-testable.

import type { GraphMode } from "./graphModes";

export function parseVizRequest(question: string): { viz: GraphMode | null } {
  const q = String(question || "").toLowerCase();
  if (/\bflow\s*-?\s*chart\b|\bmermaid\b|\bdiagram\b/.test(q)) return { viz: "mermaid" };
  if (/\bcall\s*-?\s*tree\b|\bstep\s*-?\s*list\b|\bstep[\s-]?by[\s-]?step\b|\bsteps\b/.test(q)) return { viz: "tree" };
  if (/\bdag\b|\bdependency (graph|diagram|tree)\b|\bdirected graph\b/.test(q)) return { viz: "dag" };
  if (/\bforce\s*-?\s*(graph|directed|layout)\b|\bforce graph\b/.test(q)) return { viz: "force" };
  return { viz: null };
}
