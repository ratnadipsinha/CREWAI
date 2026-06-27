// Vibe-fill: describe a block in plain English, get its fields drafted.
//
// Pluggable LLM adapter. The same interface backs every provider:
//   - "template"  : deterministic keyword fallback ($0, offline, always works)
//   - "ollama"    : local model via OpenAI-compatible endpoint ($0, private)
//   - "openai"    : any OpenAI-compatible API (incl. Claude proxies) with a key
//
// Code generation itself is NOT done here — it's deterministic (see codegen.ts).
// This only fills block content (role/goal/backstory/tools/etc).

import { BlockType } from "./types";
import { TOOL_KEYS } from "./tools";

export interface VibeSettings {
  provider: "template" | "ollama" | "openai";
  baseUrl: string; // e.g. http://localhost:11434/v1 for Ollama
  model: string; // e.g. qwen2.5-coder, claude-haiku-4-5
  apiKey: string; // only for openai-compatible
  backendUrl: string; // Python live-run backend, e.g. http://localhost:8000 ("" = in-browser run)
}

export const DEFAULT_SETTINGS: VibeSettings = {
  provider: "template",
  baseUrl: "http://localhost:11434/v1",
  model: "qwen2.5-coder",
  apiKey: "",
  backendUrl: "",
};

export interface VibeResult {
  // partial fields the caller merges into the node
  label?: string;
  role?: string;
  goal?: string;
  backstory?: string;
  tools?: string[];
  description?: string;
  expectedOutput?: string;
  event?: string;
  condition?: string;
  prompt?: string;
}

// ---- Template fallback ------------------------------------------------------

function detectTools(text: string): string[] {
  const t = text.toLowerCase();
  const hits: string[] = [];
  if (/\boutlook|microsoft 365|m365|office ?365|exchange\b/.test(t)) hits.push("outlook");
  else if (/\bgmail|email|inbox|mail\b/.test(t)) hits.push("gmail");
  if (/\bjira|ticket|issue\b/.test(t)) hits.push("jira");
  if (/\bhubspot|crm\b/.test(t)) hits.push("hubspot");
  if (/\bnetsuite\b/.test(t)) hits.push("netsuite");
  if (/\bocr|extract|scan|pdf|attachment\b/.test(t)) hits.push("ocr");
  return hits.filter((k) => TOOL_KEYS.includes(k));
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function templateFill(blockType: BlockType, prompt: string): VibeResult {
  const tools = detectTools(prompt);
  const short = prompt.trim().replace(/\.$/, "");
  switch (blockType) {
    case "agent":
      return {
        label: titleCase(short.split(/\s+/).slice(0, 3).join(" ")) || "Agent",
        role: titleCase(short.split(/\s+/).slice(0, 4).join(" ")) || "Specialist",
        goal: short || "Complete the assigned step accurately.",
        backstory: `You are an expert focused on: ${short}. You work carefully and verify your output.`,
        tools,
      };
    case "task":
      return {
        label: "Task",
        description: short || "Perform the described task.",
        expectedOutput: "A clear, structured result for the next step.",
      };
    case "trigger":
      return { label: "Trigger", event: short || "manual_start" };
    case "branch":
      return { label: "Branch", condition: short || "result.is_clean" };
    case "human":
      return {
        label: "Human step",
        prompt: short || "Please review and approve before continuing.",
      };
    default:
      return { label: "Block" };
  }
}

// ---- LLM path (OpenAI-compatible: Ollama or hosted) -------------------------

function systemPromptFor(blockType: BlockType): string {
  return [
    "You configure one block in a CrewAI visual builder.",
    `Block type: ${blockType}.`,
    `Available tool keys: ${TOOL_KEYS.join(", ")}.`,
    "Respond with ONLY a JSON object. Allowed keys depend on block type:",
    "agent -> {label, role, goal, backstory, tools[]}",
    "task -> {label, description, expectedOutput}",
    "trigger -> {label, event}",
    "branch -> {label, condition}",
    "human -> {label, prompt}",
    "tool -> {label, tools[]}",
    "Use only the listed tool keys. No prose, no markdown fences.",
  ].join("\n");
}

async function llmFill(
  settings: VibeSettings,
  blockType: BlockType,
  prompt: string,
): Promise<VibeResult> {
  const res = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPromptFor(blockType) },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? "";
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json) as VibeResult;
  // keep only known tool keys
  if (parsed.tools) parsed.tools = parsed.tools.filter((k) => TOOL_KEYS.includes(k));
  return parsed;
}

// Generic chat call against the configured OpenAI-compatible endpoint
// (Ollama / hosted). Used by the live Run. Throws on the template provider.
export async function llmChat(
  settings: VibeSettings,
  system: string,
  user: string,
): Promise<string> {
  if (settings.provider === "template") throw new Error("no LLM configured");
  const res = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.5,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

// ---- End-to-end flow generation --------------------------------------------
// Describe a whole automation -> a graph of trigger + agents + tasks + branch +
// human gate, wired together. Nodes use temporary refs; the app assigns numbered
// ids, positions, and agent links.

export interface FlowSpecNode {
  ref: string;
  type: BlockType;
  label: string;
  role?: string;
  goal?: string;
  backstory?: string;
  tools?: string[];
  description?: string;
  expectedOutput?: string;
  agentRef?: string; // for tasks: which agent runs it
  event?: string;
  condition?: string;
  prompt?: string;
}
export interface FlowSpecEdge {
  from: string;
  to: string;
  kind: "automated" | "clean" | "person";
}
export interface FlowSpec {
  nodes: FlowSpecNode[];
  edges: FlowSpecEdge[];
}

function clean(s: string): string {
  return s
    .replace(/^(and|then|also|finally|next|first|after that)\b/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;]+$/, "");
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function splitSteps(text: string): string[] {
  return text
    .replace(/\b(and )?then\b/gi, ",")
    .replace(/\bafter that\b/gi, ",")
    .split(/[,;\n]|(?:\.\s)| and (?=(?:read|fetch|pull|get|extract|run|parse|validate|check|verify|reconcile|record|write|save|store|log|create|file|open|prepare|stage|draft|compose|send|notify|post|route|require|ask|approve)\b)/i)
    .map(clean)
    .filter((s) => s.length > 3);
}

// Map a step phrase to a well-formed agent (or flag it as branch / human / trigger).
type StepKind = "agent" | "branch" | "human" | "skip";
interface StepResult {
  kind: StepKind;
  label?: string;
  role?: string;
  goal?: string;
  backstory?: string;
  tools?: string[];
  condition?: string;
  prompt?: string;
  postDecision?: boolean; // happens after a routing decision (recorder/preparer/...)
}

function classifyStep(phrase: string): StepResult {
  const p = phrase.toLowerCase();
  const tools = detectTools(phrase);
  const goal = cap(phrase) + ".";

  // human approval / authorization gate
  if (/\b(approv|authori|sign[- ]?off|a person|manually review|require.*(person|human|approval)|before (paying|sending|disbursing))/.test(p)) {
    return {
      kind: "human",
      label: "Authorization gate",
      prompt: cap(phrase) + ".",
    };
  }

  // explicit routing / branching (a standalone decision step)
  if (/\b(route|otherwise|fork|depending on|branch)\b/.test(p) || /\bif\b.*\b(then|else)\b/.test(p)) {
    return {
      kind: "branch",
      label: "Router",
      condition: "result.is_clean and not result.is_duplicate",
    };
  }

  // --- agent roles by intent ---
  if (/\b(read|fetch|pull|get|monitor|receive|download)\b/.test(p) && /\b(mail|email|inbox|gmail|outlook|exchange)\b/.test(p)) {
    return {
      kind: "agent",
      label: "Inbox Reader",
      role: "Inbox Reader",
      goal: "Read the incoming email and fetch the relevant attachment.",
      backstory: "You monitor the inbox and reliably pull the documents that need processing.",
      tools: tools.length ? tools : ["gmail"],
    };
  }
  if (/\b(extract|ocr|parse|scan|transcribe|digit)/.test(p)) {
    return {
      kind: "agent",
      label: "Extractor",
      role: "Document Extractor",
      goal: "Run OCR and turn the document into clean, structured fields.",
      backstory: "You convert messy documents into reliable structured data (vendor, dates, amounts, line items).",
      tools: tools.length ? tools : ["ocr"],
    };
  }
  if (/\b(validat|verif|check|reconcil|confirm|match|review the)/.test(p)) {
    return {
      kind: "agent",
      label: "Validator",
      role: "Validator",
      goal: cap(phrase) + ".",
      backstory: "You are a meticulous controller who flags anything that does not reconcile against the rules.",
      tools,
    };
  }
  if (/\b(summari|digest|condense|tl;?dr)/.test(p)) {
    return {
      kind: "agent",
      label: "Summarizer",
      role: "Summarizer",
      goal: cap(phrase) + ".",
      backstory: "You distill content into crisp, accurate summaries that capture what matters.",
      tools: [],
    };
  }
  if (/\b(record|writ|sav|stor|logs?\b|persist|updat)/.test(p) || /\b(crm|hubspot|netsuite)\b/.test(p)) {
    return {
      kind: "agent",
      label: "Recorder",
      role: "Recorder",
      goal: "Write the record and its status to the system of record.",
      backstory: "You keep the systems of record accurate and audit-ready.",
      tools,
      postDecision: true,
    };
  }
  if (/\bjira\b/.test(p) || /\b(create|file|open|raise|log)\b.*\b(ticket|issue|case|bug)\b/.test(p)) {
    return {
      kind: "agent",
      label: "Ticket Creator",
      role: "Ticket Creator",
      goal: cap(phrase) + ".",
      backstory: "You raise well-formed tickets so humans can act on exceptions quickly.",
      tools: tools.length ? tools : ["jira"],
      postDecision: true,
    };
  }
  if (/\b(prepar|stage|draft|compose|generate|build) .*(payment|instruction|invoice|order|run)\b/.test(p) || /\bprepar/.test(p)) {
    return {
      kind: "agent",
      label: "Preparer",
      role: "Payment Preparer",
      goal: "Stage the instruction for approval — never execute it automatically.",
      backstory: "You prepare runs for human approval and never disburse or send anything yourself.",
      tools,
      postDecision: true,
    };
  }
  if (/\b(send|notify|email back|reply|post|alert|message)\b/.test(p)) {
    return {
      kind: "agent",
      label: "Notifier",
      role: "Notifier",
      goal: cap(phrase) + ".",
      backstory: "You deliver clear, timely notifications to the right people and channels.",
      tools,
      postDecision: true,
    };
  }

  // generic agent — derive a sensible name
  const words = phrase.split(/\s+/).filter((w) => w.length > 2);
  const name = words.slice(0, 3).map(cap).join(" ") || "Agent";
  return {
    kind: "agent",
    label: name,
    role: name,
    goal,
    backstory: `You are an expert focused on: ${clean(phrase)}. You work carefully and verify your output before handing off.`,
    tools,
  };
}

function parseTrigger(prompt: string): { event: string; rest: string } {
  const m = prompt.match(/^\s*(when|whenever|on|once|after)\b([^,]*),\s*(.*)$/i);
  if (m) {
    const clause = m[2].toLowerCase();
    const tools = detectTools(clause);
    const event = tools.includes("outlook")
      ? "outlook.new_email"
      : tools.includes("gmail")
        ? "gmail.new_email"
        : clean(m[2]).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "event";
    return { event, rest: m[3] };
  }
  const tools = detectTools(prompt);
  const event = tools.includes("outlook")
    ? "outlook.new_email"
    : tools.includes("gmail")
      ? "gmail.new_email"
      : "manual_start";
  return { event, rest: prompt };
}

function templateFlow(prompt: string): FlowSpec {
  const { event, rest } = parseTrigger(prompt);
  const classified = splitSteps(rest).map(classifyStep);

  const nodes: FlowSpecNode[] = [];
  const edges: FlowSpecEdge[] = [];

  // trigger
  nodes.push({ ref: "t", type: "trigger", label: "Trigger", event });

  // agents (+ a task each), in order
  const agents = classified.filter((c) => c.kind === "agent");
  const human = classified.find((c) => c.kind === "human");
  const wantsBranch =
    classified.some((c) => c.kind === "branch") ||
    (agents.some((a) => a.label === "Validator") &&
      agents.some((a) => a.postDecision));

  const taskRefs: string[] = [];
  agents.forEach((a, i) => {
    const aRef = `a${i}`;
    const kRef = `k${i}`;
    nodes.push({
      ref: aRef,
      type: "agent",
      label: a.label!,
      role: a.role,
      goal: a.goal,
      backstory: a.backstory,
      tools: a.tools ?? [],
    });
    nodes.push({
      ref: kRef,
      type: "task",
      label: `${a.label} task`,
      description: a.goal!,
      expectedOutput: "A clear, structured result for the next step.",
      agentRef: aRef,
    });
    edges.push({ from: aRef, to: kRef, kind: "automated" });
    taskRefs.push(kRef);
  });

  // index of the first post-decision agent (recorder/preparer/etc.)
  const firstPost = agents.findIndex((a) => a.postDecision);
  const humanRef = "h";

  if (wantsBranch && firstPost > 0) {
    // chain: trigger -> a0 ... -> task(firstPost-1) -> branch -> a(firstPost) ...
    edges.push({ from: "t", to: "a0", kind: "automated" });
    for (let i = 0; i < firstPost; i++) {
      if (i > 0) edges.push({ from: taskRefs[i - 1], to: `a${i}`, kind: "automated" });
    }
    nodes.push({
      ref: "br",
      type: "branch",
      label: "Router",
      condition: "result.is_clean and not result.is_duplicate",
    });
    edges.push({ from: taskRefs[firstPost - 1], to: "br", kind: "automated" });
    edges.push({ from: "br", to: `a${firstPost}`, kind: "clean" });
    for (let i = firstPost; i < agents.length; i++) {
      if (i > firstPost) edges.push({ from: taskRefs[i - 1], to: `a${i}`, kind: "clean" });
    }
    if (human) {
      edges.push({ from: taskRefs[agents.length - 1], to: humanRef, kind: "clean" });
      edges.push({ from: "br", to: humanRef, kind: "person" }); // flagged path -> person
    }
  } else {
    // simple linear chain
    edges.push({ from: "t", to: "a0", kind: "automated" });
    for (let i = 1; i < agents.length; i++) {
      edges.push({ from: taskRefs[i - 1], to: `a${i}`, kind: "automated" });
    }
    if (human && agents.length) {
      edges.push({ from: taskRefs[agents.length - 1], to: humanRef, kind: "person" });
    }
  }

  if (human) {
    nodes.push({ ref: humanRef, type: "human", label: "Authorization gate", prompt: human.prompt });
  }

  // guard: if no agents were derived, fall back to one agent for the whole prompt
  if (!agents.length) {
    const fill = templateFill("agent", prompt);
    nodes.push({
      ref: "a0",
      type: "agent",
      label: fill.label!,
      role: fill.role,
      goal: fill.goal,
      backstory: fill.backstory,
      tools: fill.tools,
    });
    edges.push({ from: "t", to: "a0", kind: "automated" });
  }

  return { nodes, edges };
}

function flowSystemPrompt(): string {
  return [
    "You design a COMPLETE CrewAI automation as a graph from the user's description.",
    `Available tool keys: ${TOOL_KEYS.join(", ")}.`,
    "Respond with ONLY JSON: {\"nodes\":[...],\"edges\":[...]}. No markdown.",
    "Each node has a unique short \"ref\" string and a \"type\":",
    "  trigger -> {ref,type,label,event}",
    "  agent   -> {ref,type,label,role,goal,backstory,tools[]}",
    "  task    -> {ref,type,label,description,expectedOutput,agentRef}  (agentRef = ref of the agent that runs it)",
    "  branch  -> {ref,type,label,condition}",
    "  human   -> {ref,type,label,prompt}",
    "Edges: {from:ref,to:ref,kind} where kind is 'automated'|'clean'|'person'.",
    "Build a realistic end-to-end pipeline: a trigger, the agents needed, a task per agent,",
    "a branch where the flow forks on a condition, and a human gate for anything irreversible",
    "(payments, sending, deletion). Use 'person' edges into human gates, 'clean' for the happy path.",
    "Use only the listed tool keys.",
  ].join("\n");
}

async function llmFlow(settings: VibeSettings, prompt: string): Promise<FlowSpec> {
  const res = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.4,
      messages: [
        { role: "system", content: flowSystemPrompt() },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? "";
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const spec = JSON.parse(json) as FlowSpec;
  // sanitize tool keys
  spec.nodes.forEach((n) => {
    if (n.tools) n.tools = n.tools.filter((k) => TOOL_KEYS.includes(k));
  });
  if (!spec.nodes?.length) throw new Error("empty spec");
  return spec;
}

export async function vibeFlow(
  settings: VibeSettings,
  prompt: string,
): Promise<{ spec: FlowSpec; usedFallback: boolean }> {
  if (settings.provider === "template") {
    return { spec: templateFlow(prompt), usedFallback: false };
  }
  try {
    return { spec: await llmFlow(settings, prompt), usedFallback: false };
  } catch {
    return { spec: templateFlow(prompt), usedFallback: true };
  }
}

export async function vibeFill(
  settings: VibeSettings,
  blockType: BlockType,
  prompt: string,
): Promise<{ result: VibeResult; usedFallback: boolean }> {
  if (settings.provider === "template") {
    return { result: templateFill(blockType, prompt), usedFallback: false };
  }
  try {
    const result = await llmFill(settings, blockType, prompt);
    // merge any tools the template detects but the model missed
    const detected = detectTools(prompt);
    if (blockType === "agent") {
      result.tools = Array.from(new Set([...(result.tools ?? []), ...detected]));
    }
    return { result, usedFallback: false };
  } catch {
    // network down / model not running -> deterministic fallback, never blocks
    return { result: templateFill(blockType, prompt), usedFallback: true };
  }
}
