import { useEffect, useMemo, useState } from "react";
import {
  AgentNode,
  BlockType,
  Edge,
  EdgeKind,
  FlowState,
  Node,
} from "./types";
import { genLivePreview } from "./codegen";
import { exportProject } from "./exporter";
import {
  DEFAULT_SETTINGS,
  FlowSpec,
  vibeFill,
  vibeFlow,
  VibeSettings,
} from "./vibe";
import { CredStore, hasAllFields, loadCreds, saveCreds } from "./credentials";
import { TOOLS } from "./tools";

import { LeftRail } from "./components/LeftRail";
import { Canvas } from "./components/Canvas";
import { Legend } from "./components/Legend";
import { NodeCard } from "./components/NodeCard";
import { CodePanel } from "./components/CodePanel";
import { DescribeModal, DescribeMode } from "./components/DescribeModal";
import { CredentialModal } from "./components/CredentialModal";
import { RunPanel } from "./components/RunPanel";
import { ScheduleModal } from "./components/ScheduleModal";
import { SettingsModal } from "./components/SettingsModal";
import { DEFAULT_SCHEDULE, humanSummary, ScheduleConfig } from "./schedule";
import { BackendStatus } from "./components/BackendStatus";

let counter = 1; // clean canvas: numbering starts at 1.0

function newId(): string {
  return `${counter++}.0`;
}

const EMPTY_FLOW: FlowState = { nodes: [], edges: [] };

const SETTINGS_KEY = "vab_settings";
// Build-time default backend URL (set VITE_BACKEND_URL in Netlify). Lets the
// deployed site reach the live-run backend without anyone editing Settings.
const ENV_BACKEND_URL = (import.meta.env.VITE_BACKEND_URL ?? "").trim();

function loadSettings(): VibeSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const saved: VibeSettings = raw
      ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
      : DEFAULT_SETTINGS;
    // Prefer a saved backend URL; otherwise fall back to the build-time default.
    return { ...saved, backendUrl: saved.backendUrl || ENV_BACKEND_URL };
  } catch {
    return { ...DEFAULT_SETTINGS, backendUrl: ENV_BACKEND_URL };
  }
}

function blankNode(type: BlockType): Node {
  const base = { id: newId(), x: 120, y: 120, label: "" };
  switch (type) {
    case "agent":
      return { ...base, type, label: "Agent", role: "", goal: "", backstory: "", tools: [] };
    case "task":
      return { ...base, type, label: "Task", description: "", expectedOutput: "", agentId: null };
    case "trigger":
      return { ...base, type, label: "Trigger", event: "manual_start" };
    case "tool":
      return { ...base, type, label: "Tool", toolKey: "" };
    case "branch":
      return { ...base, type, label: "Branch", condition: "" };
    case "human":
      return { ...base, type, label: "Human step", prompt: "" };
    case "end":
      return { ...base, type, label: "End" };
  }
}

export default function App() {
  const [state, setState] = useState<FlowState>(EMPTY_FLOW);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [creds, setCreds] = useState<CredStore>(loadCreds());
  const [settings, setSettings] = useState<VibeSettings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);

  function saveSettings(s: VibeSettings) {
    setSettings(s);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    setSettingsOpen(false);
  }

  // describe modal state
  const [describe, setDescribe] = useState<{
    open: boolean;
    type: BlockType;
    targetId: string | null; // when redescribing an existing node
    vibe?: boolean; // launched from the "Vibe your idea" button (flow-only)
  }>({ open: false, type: "agent", targetId: null });
  const [busy, setBusy] = useState(false);

  // pending credential prompt. agentId null = collect-only (bulk flow build).
  const [credPrompt, setCredPrompt] = useState<{
    toolKey: string;
    agentId: string | null;
  } | null>(null);
  // remaining tool keys to collect credentials for after an e2e flow build
  const [credQueue, setCredQueue] = useState<string[]>([]);

  // run + schedule
  const [running, setRunning] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleConfig | null>(null);

  // Code is a pure function of state — recomputed on every change.
  const code = useMemo(() => genLivePreview(state), [state]);
  const selected = state.nodes.find((n) => n.id === selectedId) ?? null;

  // Resolve a task's agent from the connectors (same rules as codegen).
  function taskAgentId(taskId: string): string | null {
    const agents = new Set(
      state.nodes.filter((n) => n.type === "agent").map((n) => n.id),
    );
    for (const e of state.edges)
      if (e.to === taskId && agents.has(e.from)) return e.from;
    for (const e of state.edges)
      if (e.from === taskId && agents.has(e.to)) return e.to;
    return null;
  }
  function taskAgentLabel(taskId: string): string | null {
    const id = taskAgentId(taskId);
    return id ? state.nodes.find((n) => n.id === id)?.label ?? null : null;
  }
  // Tool labels for any node connected to Tool blocks.
  function toolLabelsFor(nodeId: string): string[] {
    const toolByNode = new Map(
      state.nodes
        .filter((n) => n.type === "tool")
        .map((n) => [n.id, (n as { toolKey: string }).toolKey]),
    );
    const keys = new Set<string>();
    for (const e of state.edges) {
      if (e.from === nodeId && toolByNode.has(e.to)) keys.add(toolByNode.get(e.to)!);
      if (e.to === nodeId && toolByNode.has(e.from)) keys.add(toolByNode.get(e.from)!);
    }
    return Array.from(keys)
      .filter((k) => TOOLS[k])
      .map((k) => TOOLS[k].label);
  }
  // Effective tools shown on a task: its own connected tools, else inherited from
  // the connected agent (which is what runs at runtime).
  function taskTools(taskId: string): { labels: string[]; source: "task" | "agent" | "none" } {
    const own = toolLabelsFor(taskId);
    if (own.length) return { labels: own, source: "task" };
    const agentId = taskAgentId(taskId);
    if (agentId) {
      const inherited = toolLabelsFor(agentId);
      if (inherited.length) return { labels: inherited, source: "agent" };
    }
    return { labels: [], source: "none" };
  }

  function patchNode(id: string, patch: Partial<Node>) {
    setState((s) => ({
      ...s,
      nodes: s.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as Node) : n)),
    }));
  }

  function addNode(type: BlockType) {
    const node = blankNode(type);
    setState((s) => ({ ...s, nodes: [...s.nodes, node] }));
    setSelectedId(node.id);
  }

  function deleteNode(id: string) {
    setState((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.from !== id && e.to !== id),
    }));
    setSelectedId(null);
  }

  // --- connectors (fully editable) ---
  function addEdge(from: string, to: string) {
    setState((s) => {
      if (s.edges.some((e) => e.from === from && e.to === to)) return s; // no dupes
      const edge: Edge = {
        id: `e${Date.now().toString(36)}`,
        from,
        to,
        kind: "automated",
      };
      return { ...s, edges: [...s.edges, edge] };
    });
  }

  function deleteEdge(id: string) {
    setState((s) => ({ ...s, edges: s.edges.filter((e) => e.id !== id) }));
    setSelectedEdgeId(null);
  }

  function cycleEdge(id: string) {
    const order: EdgeKind[] = ["automated", "clean", "person"];
    setState((s) => ({
      ...s,
      edges: s.edges.map((e) =>
        e.id === id
          ? { ...e, kind: order[(order.indexOf(e.kind) + 1) % order.length] }
          : e,
      ),
    }));
  }

  // Delete key removes the selected connector (when not typing in a field).
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== "Delete" && ev.key !== "Backspace") return;
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (selectedEdgeId) {
        ev.preventDefault();
        deleteEdge(selectedEdgeId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedEdgeId]);

  // --- Tool block: pick a tool, prompt its credentials on the fly ---
  function pickTool(nodeId: string, toolKey: string) {
    setState((s) => ({
      ...s,
      nodes: s.nodes.map((n) =>
        n.id === nodeId && n.type === "tool" ? { ...n, toolKey, label: toolKey ? TOOLS[toolKey].label : "Tool" } : n,
      ),
    }));
    if (!toolKey) return;
    const tool = TOOLS[toolKey];
    const fieldNames = tool.fields.map((f) => f.name);
    if (tool.auth !== "none" && !hasAllFields(creds, fieldNames)) {
      setCredPrompt({ toolKey, agentId: null }); // collect-only
    }
  }

  // Convert an end-to-end FlowSpec (temp refs) into numbered, laid-out nodes.
  function buildFromSpec(spec: FlowSpec): FlowState {
    counter = 1;
    const idByRef = new Map<string, string>();
    spec.nodes.forEach((n) => idByRef.set(n.ref, newId()));

    // simple layered layout: main column, branch targets offset right
    const colX = 120;
    const branchX = 420;
    let y = 50;
    const branchRefs = new Set(
      spec.nodes.filter((n) => n.type === "branch").map((n) => n.ref),
    );
    // refs that are a destination of a branch edge -> place in the right column
    const offRight = new Set(
      spec.edges
        .filter((e) => branchRefs.has(e.from))
        .map((e) => e.to),
    );

    const toolEdges: Edge[] = [];
    const toolNodes: Node[] = [];

    const nodes: Node[] = spec.nodes.map((n) => {
      const id = idByRef.get(n.ref)!;
      const nodeX = offRight.has(n.ref) ? branchX : colX;
      const nodeY = (y += 120) - 120;
      const base = { id, label: n.label || "Block", x: nodeX, y: nodeY };
      switch (n.type) {
        case "trigger":
          return { ...base, type: "trigger", event: n.event ?? "manual_start" };
        case "agent": {
          // spec tools -> separate Tool blocks, connected to this agent
          (n.tools ?? [])
            .filter((k) => TOOLS[k])
            .forEach((k, j) => {
              const tid = newId();
              toolNodes.push({
                id: tid,
                type: "tool",
                toolKey: k,
                label: TOOLS[k].label,
                x: nodeX + 200,
                y: nodeY + j * 70,
              });
              toolEdges.push({ id: `et${tid}`, from: id, to: tid, kind: "automated" });
            });
          return {
            ...base,
            type: "agent",
            role: n.role ?? "",
            goal: n.goal ?? "",
            backstory: n.backstory ?? "",
            tools: [], // tools now live on connected Tool blocks
          };
        }
        case "task":
          return {
            ...base,
            type: "task",
            description: n.description ?? "",
            expectedOutput: n.expectedOutput ?? "",
            agentId: n.agentRef ? idByRef.get(n.agentRef) ?? null : null,
          };
        case "tool":
          return { ...base, type: "tool", toolKey: "" };
        case "branch":
          return { ...base, type: "branch", condition: n.condition ?? "" };
        case "human":
          return { ...base, type: "human", prompt: n.prompt ?? "" };
        case "end":
          return { ...base, type: "end" };
      }
    });

    const edges = spec.edges
      .filter((e) => idByRef.has(e.from) && idByRef.has(e.to))
      .map((e, i) => ({
        id: `e${i}`,
        from: idByRef.get(e.from)!,
        to: idByRef.get(e.to)!,
        kind: e.kind,
      }));

    return { nodes: [...nodes, ...toolNodes], edges: [...edges, ...toolEdges] };
  }

  // --- vibe-fill / vibe-flow ---
  async function runGenerate(mode: DescribeMode, type: BlockType, prompt: string) {
    setBusy(true);

    if (mode === "flow") {
      const { spec, usedFallback } = await vibeFlow(settings, prompt);
      const flow = buildFromSpec(spec);
      setBusy(false);
      setState(flow);
      setSelectedId(null);
      setDescribe({ open: false, type, targetId: null });

      // collect credentials on the fly for every tool used that needs auth
      const needed = Array.from(
        new Set(
          flow.nodes.flatMap((n) => (n.type === "tool" && n.toolKey ? [n.toolKey] : [])),
        ),
      ).filter(
        (k) =>
          TOOLS[k] &&
          TOOLS[k].auth !== "none" &&
          !hasAllFields(creds, TOOLS[k].fields.map((f) => f.name)),
      );
      if (needed.length) {
        setCredQueue(needed.slice(1));
        setCredPrompt({ toolKey: needed[0], agentId: null });
      }
      if (usedFallback) console.info("Flow build used the offline template fallback.");
      return;
    }

    const { result, usedFallback } = await vibeFill(settings, type, prompt);
    setBusy(false);
    if (describe.targetId) {
      patchNode(describe.targetId, result as Partial<Node>);
    } else {
      const node = { ...blankNode(type), ...result } as Node;
      setState((s) => ({ ...s, nodes: [...s.nodes, node] }));
      setSelectedId(node.id);
    }
    setDescribe({ open: false, type, targetId: null });
    if (usedFallback) console.info("Vibe-fill used the offline template fallback.");
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Visual Agent Builder</div>
        <div className="spacer" />
        <BackendStatus backendUrl={settings.backendUrl} />
        <button onClick={() => setSettingsOpen(true)} title="LLM settings (engine, API key)">
          ⚙ {settings.provider === "template" ? "Template" : settings.model || settings.provider}
        </button>
        <button
          onClick={() => setRunning(true)}
          disabled={state.nodes.length === 0}
          title="Step through the flow (dry run)"
        >
          ▶ Run
        </button>
        <button
          onClick={() => setScheduleOpen(true)}
          title="Schedule the crew to run on an interval"
        >
          ⏰ {schedule ? humanSummary(schedule) : "Schedule"}
        </button>
        <button
          className="primary"
          onClick={() => exportProject(state, schedule)}
          disabled={state.nodes.length === 0}
        >
          ⬇ Export project
        </button>
      </header>

      <div className="body">
        <LeftRail
          onAdd={addNode}
          onVibe={() =>
            setDescribe({ open: true, type: "agent", targetId: null, vibe: true })
          }
        />

        <main
          className="stage"
          onClick={() => {
            setSelectedId(null);
            setSelectedEdgeId(null);
          }}
        >
          {state.nodes.length === 0 && (
            <div className="empty-hint">
              <div className="empty-title">Clean canvas</div>
              <p>
                Add a block from the left rail, or click <b>Describe</b> to
                generate one from plain English.
              </p>
              <p>
                Drag from a block's bottom dot to another block to connect them.
                Click a wire to recolor or delete it.
              </p>
            </div>
          )}
          <Canvas
            state={state}
            selectedId={selectedId}
            selectedEdgeId={selectedEdgeId}
            onSelect={setSelectedId}
            onSelectEdge={setSelectedEdgeId}
            onMove={(id, x, y) => patchNode(id, { x, y })}
            onAddEdge={addEdge}
            onDeleteEdge={deleteEdge}
            onCycleEdge={cycleEdge}
          />
          <Legend />
        </main>

        {selected && (
          <NodeCard
            node={selected}
            taskAgent={selected.type === "task" ? taskAgentLabel(selected.id) : undefined}
            taskTools={selected.type === "task" ? taskTools(selected.id) : undefined}
            credsSet={
              selected.type === "tool" && selected.toolKey && TOOLS[selected.toolKey]
                ? hasAllFields(creds, TOOLS[selected.toolKey].fields.map((f) => f.name))
                : undefined
            }
            onChange={(patch) => patchNode(selected.id, patch)}
            onPickTool={(k) => pickTool(selected.id, k)}
            onEditCreds={() => {
              if (selected.type === "tool" && selected.toolKey)
                setCredPrompt({ toolKey: selected.toolKey, agentId: null });
            }}
            onRedescribe={() =>
              setDescribe({
                open: true,
                type: selected.type,
                targetId: selected.id,
              })
            }
            onDelete={() => deleteNode(selected.id)}
          />
        )}

        <CodePanel code={code} />
      </div>

      {describe.open && (
        <DescribeModal
          initialType={describe.type}
          lockBlock={describe.targetId !== null}
          vibe={describe.vibe}
          busy={busy}
          onGenerate={runGenerate}
          onCancel={() => setDescribe({ open: false, type: "agent", targetId: null })}
        />
      )}

      {running && (
        <RunPanel
          state={state}
          settings={settings}
          creds={creds}
          onClose={() => setRunning(false)}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          initial={settings}
          onSave={saveSettings}
          onCancel={() => setSettingsOpen(false)}
        />
      )}

      {scheduleOpen && (
        <ScheduleModal
          initial={schedule ?? DEFAULT_SCHEDULE}
          onSave={(cfg) => {
            setSchedule(cfg);
            setScheduleOpen(false);
          }}
          onCancel={() => setScheduleOpen(false)}
        />
      )}

      {credPrompt && (
        <CredentialModal
          toolKey={credPrompt.toolKey}
          creds={creds}
          onCancel={() => {
            setCredPrompt(null);
            setCredQueue([]);
          }}
          onSave={(values) => {
            const next = { ...creds, ...values };
            setCreds(next);
            saveCreds(next);
            // advance the bulk queue from an e2e flow build
            if (credQueue.length) {
              const [nextKey, ...rest] = credQueue;
              setCredQueue(rest);
              setCredPrompt({ toolKey: nextKey, agentId: null });
            } else {
              setCredPrompt(null);
            }
          }}
        />
      )}
    </div>
  );
}

// keep the AgentNode import referenced for type-narrowing clarity
export type { AgentNode };
