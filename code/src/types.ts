// The canvas state is the single source of truth. The generated CrewAI code is a
// pure function of this data model (see codegen.ts).

export type BlockType =
  | "trigger"
  | "agent"
  | "task"
  | "tool"
  | "branch"
  | "human"
  | "end";

export interface BaseNode {
  id: string; // numbered identity, e.g. "1.0", "2.0"
  type: BlockType;
  label: string;
  x: number;
  y: number;
}

export interface TriggerNode extends BaseNode {
  type: "trigger";
  event: string;
}
export interface AgentNode extends BaseNode {
  type: "agent";
  role: string;
  goal: string;
  backstory: string;
  tools: string[]; // tool keys from tools.ts
}
export interface TaskNode extends BaseNode {
  type: "task";
  description: string;
  expectedOutput: string;
  agentId: string | null; // id of the AgentNode that runs it
}
export interface ToolNode extends BaseNode {
  type: "tool";
  toolKey: string; // selected on the Tool block; "" until chosen
}
export interface BranchNode extends BaseNode {
  type: "branch";
  condition: string;
}
export interface HumanNode extends BaseNode {
  type: "human";
  prompt: string;
}
export interface EndNode extends BaseNode {
  type: "end";
}

export type Node =
  | TriggerNode
  | AgentNode
  | TaskNode
  | ToolNode
  | BranchNode
  | HumanNode
  | EndNode;

// Connector colours from the canvas legend.
export type EdgeKind = "automated" | "clean" | "person";

export interface Edge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface FlowState {
  nodes: Node[];
  edges: Edge[];
}

export const EDGE_COLORS: Record<EdgeKind, string> = {
  automated: "#8b5cf6", // purple
  clean: "#22c55e", // green
  person: "#ec4899", // pink
};

export const BLOCK_META: Record<
  BlockType,
  { label: string; icon: string; color: string }
> = {
  trigger: { label: "Trigger", icon: "⚡", color: "#f59e0b" },
  agent: { label: "Agent", icon: "🤖", color: "#3b82f6" },
  task: { label: "Task", icon: "📋", color: "#06b6d4" },
  tool: { label: "Tool", icon: "🔧", color: "#64748b" },
  branch: { label: "Branch", icon: "🔀", color: "#8b5cf6" },
  human: { label: "Human step", icon: "🙋", color: "#ec4899" },
  end: { label: "End", icon: "🏁", color: "#475569" },
};
