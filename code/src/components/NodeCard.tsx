import { useState } from "react";
import { Node } from "../types";
import { TOOLS, TOOL_KEYS } from "../tools";

// Detail card for the selected node. Agents have no tool option — instead a Tool
// block carries the tool choice (which triggers the on-the-fly credential prompt
// via onPickTool) and is connected to an agent on the canvas to attach it.
export function NodeCard({
  node,
  taskAgent,
  taskTools,
  credsSet,
  onChange,
  onPickTool,
  onEditCreds,
  onRedescribe,
  onDelete,
  onClose,
}: {
  node: Node;
  taskAgent?: string | null; // resolved from connectors (task only)
  taskTools?: { labels: string[]; source: "task" | "agent" | "none" }; // task only
  credsSet?: boolean; // tool only — are this tool's credentials filled in?
  onChange: (patch: Partial<Node>) => void;
  onPickTool: (toolKey: string) => void;
  onEditCreds: () => void;
  onRedescribe: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  // Floating, draggable window — positioned over the canvas, not eating its width.
  const [pos, setPos] = useState(() => ({
    x: Math.max(20, window.innerWidth - 380),
    y: 100,
  }));

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = pos.x, oy = pos.y;
    function mv(ev: MouseEvent) {
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 80, ox + ev.clientX - sx)),
        y: Math.max(56, Math.min(window.innerHeight - 60, oy + ev.clientY - sy)),
      });
    }
    function up() {
      window.removeEventListener("mousemove", mv);
      window.removeEventListener("mouseup", up);
    }
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
  }

  return (
    <aside className="card card-floating" style={{ left: pos.x, top: pos.y }}>
      <div className="card-drag" onMouseDown={startDrag}>
        <span className="card-drag-grip">⠿ Properties · {node.id}</span>
        <button className="card-close" title="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="card-head">
        <span className="card-id">{node.id}</span>
        <input
          className="card-title"
          value={node.label}
          onChange={(e) => onChange({ label: e.target.value })}
        />
      </div>

      {node.type === "agent" && (
        <>
          <Field label="Role" value={node.role} onChange={(v) => onChange({ role: v })} />
          <Field label="Goal" value={node.goal} onChange={(v) => onChange({ goal: v })} area />
          <Field
            label="Backstory"
            value={node.backstory}
            onChange={(v) => onChange({ backstory: v })}
            area
          />
          <p className="muted small">
            To give this agent a tool, add a <b>Tool</b> block and connect it to
            this agent on the canvas.
          </p>
        </>
      )}

      {node.type === "tool" && (
        <div className="field">
          <span>Tool</span>
          <select value={node.toolKey} onChange={(e) => onPickTool(e.target.value)}>
            <option value="">choose a tool…</option>
            {TOOL_KEYS.map((k) => (
              <option key={k} value={k}>
                {TOOLS[k].label} ({TOOLS[k].auth})
              </option>
            ))}
          </select>
          {node.toolKey && TOOLS[node.toolKey] && (
            <p className="muted small">{TOOLS[node.toolKey].description}</p>
          )}

          {node.toolKey && TOOLS[node.toolKey]?.auth !== "none" && (
            <div className="creds-row">
              <span className={`creds-status ${credsSet ? "ok" : "missing"}`}>
                {credsSet ? "✓ credentials set" : "credentials needed"}
              </span>
              <button className="ghost" onClick={onEditCreds}>
                {credsSet ? "Edit credentials" : "Add credentials"}
              </button>
            </div>
          )}

          <p className="muted small">
            Connect this block to an agent to attach the tool.
          </p>
        </div>
      )}

      {node.type === "task" && (
        <>
          <Field
            label="Description"
            value={node.description}
            onChange={(v) => onChange({ description: v })}
            area
          />
          <Field
            label="Expected output"
            value={node.expectedOutput}
            onChange={(v) => onChange({ expectedOutput: v })}
            area
          />
          <div className="field">
            <span>Agent (from connector)</span>
            <div className={`conn-text ${taskAgent ? "" : "missing"}`}>
              {taskAgent || "— connect an agent to this task —"}
            </div>
          </div>
          <div className="field">
            <span>
              Tools (from connector)
              {taskTools?.source === "agent" && " — via agent"}
              {taskTools?.source === "task" && " — task-level"}
            </span>
            <div className={`conn-text ${taskTools && taskTools.labels.length ? "" : "missing"}`}>
              {taskTools && taskTools.labels.length
                ? taskTools.labels.join(", ")
                : "— no tools connected to this task or its agent —"}
            </div>
          </div>
        </>
      )}

      {node.type === "trigger" && (
        <Field label="Event" value={node.event} onChange={(v) => onChange({ event: v })} />
      )}
      {node.type === "branch" && (
        <Field
          label="Condition"
          value={node.condition}
          onChange={(v) => onChange({ condition: v })}
          area
        />
      )}
      {node.type === "human" && (
        <Field
          label="Prompt"
          value={node.prompt}
          onChange={(v) => onChange({ prompt: v })}
          area
        />
      )}

      <div className="card-actions">
        <button className="ghost" onClick={onRedescribe}>
          ✨ Redescribe
        </button>
        <button className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </aside>
  );
}

function Field({
  label,
  value,
  onChange,
  area,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  area?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {area ? (
        <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}
