// Executes one flow step during a Run.
//  - template provider  -> returns a mock outcome (dry run, no LLM)
//  - ollama / api        -> drives the agent through the LLM: each task is sent to
//                           its agent's persona with the running context, and the
//                           real model output is returned.
// Tools (Gmail/Jira/...) are not actually called here — that happens in the
// exported project. This runs the *reasoning* of the crew live.

import { AgentNode, FlowState, Node, TaskNode } from "./types";
import { llmChat, VibeSettings } from "./vibe";
import { mockOutput } from "./runner";
import { TOOLS } from "./tools";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// resolve the agent that runs a task (Agent -> Task edge, like codegen)
function resolveAgent(state: FlowState, task: TaskNode): AgentNode | undefined {
  const agents = new Map(
    state.nodes.filter((n): n is AgentNode => n.type === "agent").map((n) => [n.id, n]),
  );
  for (const e of state.edges)
    if (e.to === task.id && agents.has(e.from)) return agents.get(e.from);
  for (const e of state.edges)
    if (e.from === task.id && agents.has(e.to)) return agents.get(e.to);
  return task.agentId ? agents.get(task.agentId) : undefined;
}

function agentToolNames(state: FlowState, agentId: string): string[] {
  const toolByNode = new Map(
    state.nodes.filter((n) => n.type === "tool").map((n) => [n.id, (n as any).toolKey]),
  );
  const keys = new Set<string>();
  for (const e of state.edges) {
    if (e.from === agentId && toolByNode.has(e.to)) keys.add(toolByNode.get(e.to));
    if (e.to === agentId && toolByNode.has(e.from)) keys.add(toolByNode.get(e.from));
  }
  return Array.from(keys)
    .filter((k) => TOOLS[k])
    .map((k) => TOOLS[k].label);
}

export async function executeStep(
  settings: VibeSettings,
  node: Node,
  state: FlowState,
  context: string,
): Promise<string> {
  // dry run
  if (settings.provider === "template") {
    await sleep(500);
    return mockOutput(node);
  }

  // live run
  if (node.type === "task") {
    const agent = resolveAgent(state, node);
    const tools = agent ? agentToolNames(state, agent.id) : [];
    const system = agent
      ? `You are "${agent.role}". Goal: ${agent.goal}. Backstory: ${agent.backstory}` +
        (tools.length ? ` You have access to these tools (assume their results): ${tools.join(", ")}.` : "")
      : "You are a helpful agent in an automation.";
    const user =
      `Task: ${node.description}\n` +
      `Expected output: ${node.expectedOutput || "a clear result"}\n\n` +
      `Context from earlier steps:\n${context || "(none yet)"}\n\n` +
      `Perform the task and return ONLY the result (concise).`;
    return llmChat(settings, system, user);
  }
  if (node.type === "agent") {
    await sleep(200);
    return `${(node as AgentNode).role} ready`;
  }
  // trigger / branch / human / end
  await sleep(200);
  return mockOutput(node);
}
