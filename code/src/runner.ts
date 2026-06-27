// Step-through run of the composed flow. This is an in-browser *dry run* — it
// walks the graph in execution order, shows each step working, and stops at the
// human gate for approval. The real crew runs from the exported project
// (python main.py); this previews the orchestration without a backend.

import { FlowState, Node } from "./types";

// Topological order of executable nodes (tool blocks are attachments, skipped).
export function runOrder(state: FlowState): Node[] {
  const nodes = state.nodes.filter((n) => n.type !== "tool");
  const ids = new Set(nodes.map((n) => n.id));
  const edges = state.edges.filter((e) => ids.has(e.from) && ids.has(e.to));

  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    adj.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ready = nodes
    .filter((n) => (indeg.get(n.id) ?? 0) === 0)
    .sort((a, b) => a.y - b.y);
  const order: Node[] = [];
  const seen = new Set<string>();

  while (ready.length) {
    const n = ready.shift()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    order.push(n);
    for (const to of adj.get(n.id) ?? []) {
      indeg.set(to, (indeg.get(to) ?? 1) - 1);
      if ((indeg.get(to) ?? 0) === 0 && !seen.has(to)) ready.push(byId.get(to)!);
    }
    ready.sort((a, b) => a.y - b.y);
  }
  // append any nodes left out by a cycle
  for (const n of nodes) if (!seen.has(n.id)) order.push(n);
  return order;
}

export type StepStatus = "pending" | "running" | "done" | "await" | "halted";

export interface RunStep {
  id: string;
  icon: string;
  title: string;
  detail: string;
  status: StepStatus;
  output?: string; // outcome produced when the step completes
}

function shorten(s: string, n = 70): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// A plausible mock outcome for a step (this is a dry run — the real outputs come
// from the LLM/tools when you run the exported project).
export function mockOutput(node: Node): string {
  switch (node.type) {
    case "trigger":
      return `event received → ${node.event}`;
    case "agent":
      return `${node.label} produced output${node.tools?.length ? ` using ${node.tools.join(", ")}` : ""}`;
    case "task":
      return `result: ${shorten(node.description || node.label)}`;
    case "branch":
      return `routed via "clean" path  (condition: ${shorten(node.condition, 50)})`;
    case "human":
      return "approved";
    case "end":
      return "workflow ended";
    default:
      return "done";
  }
}

// A human-readable line describing what each node does when it runs.
export function describe(node: Node): { title: string; detail: string; icon: string } {
  switch (node.type) {
    case "trigger":
      return { icon: "⚡", title: "Trigger fired", detail: node.event };
    case "agent":
      return { icon: "🤖", title: node.label, detail: node.goal || node.role };
    case "task":
      return { icon: "📋", title: node.label, detail: node.description };
    case "branch":
      return { icon: "🔀", title: node.label, detail: `condition: ${node.condition}` };
    case "human":
      return { icon: "🙋", title: node.label, detail: node.prompt };
    case "end":
      return { icon: "🏁", title: "End", detail: "workflow ends here" };
    default:
      return { icon: "▫", title: node.label, detail: "" };
  }
}
