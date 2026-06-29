// Deterministic CrewAI code generation. Pure function: FlowState -> files.
// Runs client-side on every canvas change; identical input always yields identical
// output. No LLM involved. Export uses the same functions, split into a project.

import {
  AgentNode,
  FlowState,
  Node,
  TaskNode,
  TriggerNode,
} from "./types";
import { TOOLS } from "./tools";

function py(s: string): string {
  // safe Python string body for triple-quoted blocks
  return s.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
}

function varName(node: Node): string {
  const base = node.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safe = base || node.type;
  return `${safe}_${node.id.replace(".", "_")}`;
}

// Tools are Tool blocks connected by an edge to an agent. Returns the tool keys
// attached to a given agent.
function agentToolKeys(state: FlowState, agentId: string): string[] {
  const toolByNode = new Map(
    state.nodes
      .filter((n): n is import("./types").ToolNode => n.type === "tool")
      .map((n) => [n.id, n.toolKey]),
  );
  const keys = new Set<string>();
  for (const e of state.edges) {
    if (e.from === agentId && toolByNode.has(e.to)) keys.add(toolByNode.get(e.to)!);
    if (e.to === agentId && toolByNode.has(e.from)) keys.add(toolByNode.get(e.from)!);
  }
  return Array.from(keys).filter((k) => TOOLS[k]);
}

function usedToolKeys(state: FlowState): string[] {
  const keys = new Set<string>();
  for (const n of state.nodes) {
    if (n.type === "agent") agentToolKeys(state, n.id).forEach((k) => keys.add(k));
  }
  return Array.from(keys).filter((k) => TOOLS[k]);
}

// ---- tools.py ---------------------------------------------------------------

export function genToolsFile(state: FlowState): string {
  const keys = usedToolKeys(state);
  if (keys.length === 0) return "# No tools configured.\n";
  const imports = new Set<string>();
  keys.forEach((k) => imports.add(TOOLS[k].pyImport));
  const lines: string[] = [
    '"""Tool instances for the crew. Credentials come from environment variables."""',
    "import os",
    ...Array.from(imports),
    "",
  ];
  // helper builders referenced by pyInit for basic/apikey tools
  if (keys.includes("jira")) {
    lines.push(
      "def make_jira_tool():",
      "    jira = JIRA(server=os.environ['JIRA_URL'],",
      "                basic_auth=(os.environ['JIRA_USER'], os.environ['JIRA_TOKEN']))",
      "    @tool('create_jira_ticket')",
      "    def create_jira_ticket(summary: str, description: str) -> str:",
      '        """Create a Jira issue."""',
      "        issue = jira.create_issue(project='OPS', summary=summary,",
      "                                  description=description, issuetype={'name': 'Task'})",
      "        return f'Created {issue.key}'",
      "    return create_jira_ticket",
      "",
    );
  }
  if (keys.includes("hubspot")) {
    lines.push(
      "def make_hubspot_tool():",
      "    @tool('write_hubspot_record')",
      "    def write_hubspot_record(payload: str) -> str:",
      '        """Write an invoice record to HubSpot CRM."""',
      "        r = requests.post('https://api.hubapi.com/crm/v3/objects/invoices',",
      "                          headers={'Authorization': f\"Bearer {os.environ['HUBSPOT_API_KEY']}\"},",
      "                          json={'properties': {'raw': payload}})",
      "        return f'HubSpot {r.status_code}'",
      "    return write_hubspot_record",
      "",
    );
  }
  if (keys.includes("gmail_send")) {
    lines.push(
      "def make_gmail_send_tool():",
      "    @tool('send_gmail')",
      "    def send_gmail(to: str, subject: str, body: str) -> str:",
      '        """Send an email from the connected Gmail account."""',
      "        tok = requests.post('https://oauth2.googleapis.com/token', data={",
      "            'grant_type': 'refresh_token',",
      "            'refresh_token': os.environ['GMAIL_REFRESH_TOKEN'],",
      "            'client_id': os.environ['GMAIL_CLIENT_ID'],",
      "            'client_secret': os.environ['GMAIL_CLIENT_SECRET'],",
      "        }, timeout=30).json()['access_token']",
      "        msg = EmailMessage(); msg['To'] = to; msg['Subject'] = subject; msg.set_content(body)",
      "        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()",
      "        r = requests.post('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',",
      "                          headers={'Authorization': f'Bearer {tok}'}, json={'raw': raw}, timeout=30)",
      "        return 'sent' if r.ok else f'[gmail {r.status_code}] {r.text}'",
      "    return send_gmail",
      "",
    );
  }
  if (keys.includes("netsuite")) {
    lines.push(
      "def make_netsuite_tool():",
      "    @tool('record_in_netsuite')",
      "    def record_in_netsuite(payload: str) -> str:",
      '        """Record an invoice + status in NetSuite."""',
      "        # auth via NETSUITE_* env vars",
      "        return 'recorded'",
      "    return record_in_netsuite",
      "",
    );
  }
  keys.forEach((k) => {
    lines.push(`${TOOLS[k].pyVar} = ${TOOLS[k].pyInit}`);
  });
  lines.push("");
  return lines.join("\n");
}

// ---- agents.py --------------------------------------------------------------

function genAgent(node: AgentNode, toolKeys: string[]): string {
  const toolVars = toolKeys
    .filter((k) => TOOLS[k])
    .map((k) => `tools.${TOOLS[k].pyVar}`)
    .join(", ");
  return [
    `${varName(node)} = Agent(`,
    `    role="""${py(node.role)}""",`,
    `    goal="""${py(node.goal)}""",`,
    `    backstory="""${py(node.backstory)}""",`,
    `    tools=[${toolVars}],`,
    "    verbose=True,",
    ")",
  ].join("\n");
}

export function genAgentsFile(state: FlowState): string {
  const agents = state.nodes.filter((n): n is AgentNode => n.type === "agent");
  const hasTools = usedToolKeys(state).length > 0;
  const lines = [
    '"""Agents composed on the canvas."""',
    "from crewai import Agent",
    ...(hasTools ? ["import tools"] : []),
    "",
    ...agents.map((a) => genAgent(a, agentToolKeys(state, a.id))),
    "",
  ];
  return lines.join("\n\n");
}

// ---- tasks.py ---------------------------------------------------------------

// Resolve the agent that RUNS a task from the connectors.
// Preference: an edge Agent -> Task (the "runs" direction). Fallbacks: any agent
// connected to the task, then the stored agentId.
function resolveTaskAgent(state: FlowState, task: TaskNode): AgentNode | undefined {
  const agents = new Map(
    state.nodes.filter((n): n is AgentNode => n.type === "agent").map((n) => [n.id, n]),
  );
  // 1. agent -> task
  for (const e of state.edges) {
    if (e.to === task.id && agents.has(e.from)) return agents.get(e.from);
  }
  // 2. any connection task <-> agent
  for (const e of state.edges) {
    if (e.from === task.id && agents.has(e.to)) return agents.get(e.to);
  }
  // 3. stored fallback
  return task.agentId ? agents.get(task.agentId) : undefined;
}

// Tool blocks connected directly to a task -> task-level tools (override agent's).
function taskToolKeys(state: FlowState, taskId: string): string[] {
  const toolByNode = new Map(
    state.nodes
      .filter((n): n is import("./types").ToolNode => n.type === "tool")
      .map((n) => [n.id, n.toolKey]),
  );
  const keys = new Set<string>();
  for (const e of state.edges) {
    if (e.from === taskId && toolByNode.has(e.to)) keys.add(toolByNode.get(e.to)!);
    if (e.to === taskId && toolByNode.has(e.from)) keys.add(toolByNode.get(e.from)!);
  }
  return Array.from(keys).filter((k) => TOOLS[k]);
}

function genTask(node: TaskNode, state: FlowState): string {
  const agent = resolveTaskAgent(state, node);
  const agentRef = agent ? varName(agent) : "None  # connect an agent to this task";
  const toolKeys = taskToolKeys(state, node.id);
  const toolsLine = toolKeys.length
    ? `    tools=[${toolKeys.map((k) => `tools.${TOOLS[k].pyVar}`).join(", ")}],\n`
    : "";
  return [
    `${varName(node)} = Task(`,
    `    description="""${py(node.description)}""",`,
    `    expected_output="""${py(node.expectedOutput)}""",`,
    `    agent=${agentRef},`,
    toolsLine + ")",
  ].join("\n");
}

// any task with directly-connected tools?
function anyTaskTools(state: FlowState): boolean {
  return state.nodes.some(
    (n) => n.type === "task" && taskToolKeys(state, n.id).length > 0,
  );
}

export function genTasksFile(state: FlowState): string {
  const tasks = state.nodes.filter((n): n is TaskNode => n.type === "task");
  return [
    '"""Tasks composed on the canvas."""',
    "from crewai import Task",
    "import agents",
    ...(anyTaskTools(state) ? ["import tools"] : []),
    "",
    "# agent references",
    ...state.nodes
      .filter((n): n is AgentNode => n.type === "agent")
      .map((a) => `${varName(a)} = agents.${varName(a)}`),
    "",
    ...tasks.map((t) => genTask(t, state)),
    "",
  ].join("\n\n");
}

// ---- crew.py ----------------------------------------------------------------

// Executable nodes (tool blocks are attachments) and the edges among them.
function execGraph(state: FlowState) {
  const ids = new Set(state.nodes.filter((n) => n.type !== "tool").map((n) => n.id));
  const edges = state.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  return { ids, edges };
}

function forwardReach(state: FlowState, seeds: string[]): Set<string> {
  const { edges } = execGraph(state);
  const adj = new Map<string, string[]>();
  for (const e of edges) (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
  const out = new Set<string>(seeds); // include the seeds themselves
  const stack = [...seeds];
  while (stack.length) {
    const id = stack.pop()!;
    for (const to of adj.get(id) ?? []) if (!out.has(to)) { out.add(to); stack.push(to); }
  }
  return out;
}

function ancestors(state: FlowState, target: string): Set<string> {
  const { edges } = execGraph(state);
  const radj = new Map<string, string[]>();
  for (const e of edges) (radj.get(e.to) ?? radj.set(e.to, []).get(e.to)!).push(e.from);
  const out = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const id = stack.pop()!;
    for (const from of radj.get(id) ?? []) if (!out.has(from)) { out.add(from); stack.push(from); }
  }
  return out;
}

// tasks (in canvas order) and their agents within a node-id set
function segment(state: FlowState, set: Set<string>) {
  const tasks = state.nodes.filter(
    (n): n is TaskNode => n.type === "task" && set.has(n.id),
  );
  const agentVars = new Set<string>();
  for (const t of tasks) {
    const a = resolveTaskAgent(state, t);
    if (a) agentVars.add(`agents.${varName(a)}`);
  }
  return {
    agents: Array.from(agentVars),
    tasks: tasks.map((t) => `tasks.${varName(t)}`),
    humans: state.nodes.filter((n) => n.type === "human" && set.has(n.id)),
  };
}

function humanGate(prompt: string, indent: string): string[] {
  return [
    `${indent}# Human authorization gate — nothing proceeds without approval`,
    `${indent}print(${JSON.stringify(prompt)})`,
    `${indent}if input("Approve? [y/N] ").strip().lower() != "y":`,
    `${indent}    return "Halted: not approved by human."`,
  ];
}

export function genCrewFile(state: FlowState): string {
  const branches = state.nodes.filter((n) => n.type === "branch");
  // Exactly one branch -> emit a CrewAI Flow with @router/@listen.
  if (branches.length === 1) return genFlowCrew(state, branches[0].id);
  return genSequentialCrew(state);
}

function genSequentialCrew(state: FlowState): string {
  const agents = state.nodes.filter((n): n is AgentNode => n.type === "agent");
  const tasks = state.nodes.filter((n): n is TaskNode => n.type === "task");
  const human = state.nodes.find((n) => n.type === "human");
  const lines = [
    '"""Crew assembly + human authorization gate."""',
    "from crewai import Crew, Process",
    "import agents, tasks",
    "",
    "crew = Crew(",
    `    agents=[${agents.map((a) => `agents.${varName(a)}`).join(", ")}],`,
    `    tasks=[${tasks.map((t) => `tasks.${varName(t)}`).join(", ")}],`,
    "    process=Process.sequential,",
    "    verbose=True,",
    ")",
    "",
    "def run(inputs=None):",
    "    result = crew.kickoff(inputs=inputs or {})",
  ];
  if (human) {
    lines.push(...humanGate((human as any).prompt, "    "));
    lines.push("    print(result)");
  }
  lines.push("    return result", "");
  return lines.join("\n");
}

function genFlowCrew(state: FlowState, branchId: string): string {
  const branch = state.nodes.find((n) => n.id === branchId) as
    | { condition: string }
    | undefined;
  const condition = (branch?.condition || "result.is_clean").trim();

  // segment the graph around the branch
  const pre = segment(state, ancestors(state, branchId));
  const cleanSeeds = state.edges
    .filter((e) => e.from === branchId && (e.kind === "clean" || e.kind === "automated"))
    .map((e) => e.to);
  const flaggedSeeds = state.edges
    .filter((e) => e.from === branchId && e.kind === "person")
    .map((e) => e.to);
  const clean = segment(state, forwardReach(state, cleanSeeds));
  const flagged = segment(state, forwardReach(state, flaggedSeeds));

  const crewExpr = (s: { agents: string[]; tasks: string[] }) =>
    `_crew([${s.agents.join(", ")}], [${s.tasks.join(", ")}])`;

  const out: string[] = [
    '"""Conditional flow — Branch routes the run via @router/@listen."""',
    "from crewai import Crew, Process",
    "from crewai.flow.flow import Flow, start, router, listen",
    "import agents, tasks",
    "",
    "def _crew(agent_list, task_list):",
    "    return Crew(agents=agent_list, tasks=task_list, process=Process.sequential, verbose=True)",
    "",
    "class GeneratedFlow(Flow):",
    "    @start()",
    "    def pre(self):",
    pre.tasks.length
      ? `        result = ${crewExpr(pre)}.kickoff()`
      : "        result = None  # no upstream tasks",
    "        self.state['result'] = result",
    "        return result",
    "",
    "    @router(pre)",
    "    def route(self):",
    "        result = self.state.get('result')",
    `        # Branch condition (from the canvas): ${condition}`,
    "        try:",
    `            decision = bool(${condition})`,
    "        except Exception:",
    "            decision = True  # default to the clean path if the condition can't be evaluated",
    '        return "clean" if decision else "flagged"',
    "",
    '    @listen("clean")',
    "    def clean_path(self):",
    ...(clean.tasks.length
      ? [`        result = ${crewExpr(clean)}.kickoff()`]
      : ["        result = None  # no clean-path tasks"]),
    ...clean.humans.flatMap((h) => humanGate((h as any).prompt, "        ")),
    "        return result",
    "",
    '    @listen("flagged")',
    "    def flagged_path(self):",
    ...(flagged.tasks.length
      ? [`        result = ${crewExpr(flagged)}.kickoff()`]
      : ["        result = None  # exception path (often just a human review)"]),
    ...flagged.humans.flatMap((h) => humanGate((h as any).prompt, "        ")),
    "        return result",
    "",
    "def run(inputs=None):",
    "    return GeneratedFlow().kickoff(inputs=inputs or {})",
    "",
  ];
  return out.join("\n");
}

// ---- main.py ----------------------------------------------------------------

export function genMainFile(state: FlowState): string {
  const trigger = state.nodes.find(
    (n): n is TriggerNode => n.type === "trigger",
  );
  return [
    '"""Entry point. Run: python main.py"""',
    "from dotenv import load_dotenv",
    "import crew",
    "",
    "load_dotenv()",
    "",
    'if __name__ == "__main__":',
    `    # Trigger: ${trigger ? trigger.event : "manual"}`,
    "    print(crew.run())",
    "",
  ].join("\n");
}

// ---- requirements + .env.example -------------------------------------------

export function genRequirements(state: FlowState): string {
  const keys = usedToolKeys(state);
  const base = ["crewai>=0.80", "crewai-tools>=0.14", "python-dotenv>=1.0"];
  if (keys.includes("jira")) base.push("jira>=3.8");
  if (keys.includes("hubspot") || keys.includes("netsuite"))
    base.push("requests>=2.31");
  return base.join("\n") + "\n";
}

export function genEnvExample(state: FlowState): string {
  const keys = usedToolKeys(state);
  const lines = ["# Credentials — fill in real values, never commit this file.", "CLAUDE_API_KEY="];
  keys.forEach((k) => {
    TOOLS[k].fields.forEach((f) => lines.push(`${f.name}=`));
  });
  return lines.join("\n") + "\n";
}

// ---- combined live preview --------------------------------------------------

export function genLivePreview(state: FlowState): string {
  return [
    "# ===== tools.py =====",
    genToolsFile(state),
    "# ===== agents.py =====",
    genAgentsFile(state),
    "# ===== tasks.py =====",
    genTasksFile(state),
    "# ===== crew.py =====",
    genCrewFile(state),
    "# ===== main.py =====",
    genMainFile(state),
  ].join("\n");
}

export function genProjectFiles(state: FlowState): Record<string, string> {
  return {
    "tools.py": genToolsFile(state),
    "agents.py": genAgentsFile(state),
    "tasks.py": genTasksFile(state),
    "crew.py": genCrewFile(state),
    "main.py": genMainFile(state),
    "requirements.txt": genRequirements(state),
    ".env.example": genEnvExample(state),
  };
}
