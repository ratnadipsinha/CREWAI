import { useRef, useState } from "react";
import { BLOCK_META, EDGE_COLORS, FlowState, Node } from "../types";

const NODE_W = 60;
const NODE_H = 60;

function center(node: Node) {
  return { cx: node.x + NODE_W / 2, cy: node.y + NODE_H / 2 };
}

function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const dy = Math.abs(y2 - y1) * 0.5 + 20;
  return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
}

interface Pending {
  from: string;
  x: number; // cursor position relative to canvas
  y: number;
}

export function Canvas({
  state,
  selectedId,
  selectedEdgeId,
  onSelect,
  onSelectEdge,
  onMove,
  onAddEdge,
  onDeleteEdge,
  onCycleEdge,
}: {
  state: FlowState;
  selectedId: string | null;
  selectedEdgeId: string | null;
  onSelect: (id: string) => void;
  onSelectEdge: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onAddEdge: (from: string, to: string) => void;
  onDeleteEdge: (id: string) => void;
  onCycleEdge: (id: string) => void;
}) {
  const byId = new Map(state.nodes.map((n) => [n.id, n]));
  const canvasRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  function toCanvas(clientX: number, clientY: number) {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  // --- drag a node ---
  function startDrag(e: React.MouseEvent, node: Node) {
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const ox = node.x;
    const oy = node.y;
    function move(ev: MouseEvent) {
      onMove(node.id, ox + (ev.clientX - startX), oy + (ev.clientY - startY));
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // --- drag a NEW connection from either handle ---
  function startConnect(e: React.MouseEvent, node: Node) {
    e.stopPropagation();
    e.preventDefault();
    const p = toCanvas(e.clientX, e.clientY);
    setPending({ from: node.id, x: p.x, y: p.y });
    function move(ev: MouseEvent) {
      const q = toCanvas(ev.clientX, ev.clientY);
      setPending((cur) => (cur ? { ...cur, x: q.x, y: q.y } : cur));
    }
    function up(ev: MouseEvent) {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      // resolve the block under the cursor on release
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const targetEl = el?.closest("[data-node-id]") as HTMLElement | null;
      const targetId = targetEl?.dataset.nodeId;
      if (targetId && targetId !== node.id) onAddEdge(node.id, targetId);
      setPending(null);
      setHover(null);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  function dropConnect(target: Node) {
    if (pending && pending.from !== target.id) {
      onAddEdge(pending.from, target.id);
    }
    setPending(null);
    setHover(null);
  }

  return (
    <div
      className="canvas"
      ref={canvasRef}
      onClick={() => onSelectEdge(null)}
    >
      <svg className="wires">
        {/* existing edges */}
        {state.edges.map((e) => {
          const from = byId.get(e.from);
          const to = byId.get(e.to);
          if (!from || !to) return null;
          const a = center(from);
          const b = center(to);
          const d = bezier(a.cx, from.y + NODE_H, b.cx, to.y);
          const selected = selectedEdgeId === e.id;
          return (
            <g key={e.id}>
              {/* wide invisible hit area for easy clicking */}
              <path
                d={d}
                stroke="transparent"
                strokeWidth={16}
                fill="none"
                style={{ pointerEvents: "stroke", cursor: "pointer" }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSelectEdge(e.id);
                }}
              />
              <path
                d={d}
                stroke={EDGE_COLORS[e.kind]}
                strokeWidth={selected ? 5 : 3}
                fill="none"
                strokeDasharray={selected ? "6 4" : undefined}
                style={{ pointerEvents: "none" }}
              />
            </g>
          );
        })}

        {/* pending connection preview */}
        {pending &&
          (() => {
            const from = byId.get(pending.from)!;
            const a = center(from);
            return (
              <path
                d={bezier(a.cx, from.y + NODE_H, pending.x, pending.y)}
                stroke="#0ea5e9"
                strokeWidth={3}
                strokeDasharray="5 5"
                fill="none"
              />
            );
          })()}
      </svg>

      {/* edge controls (cycle colour / delete) at midpoint of selected edge */}
      {selectedEdgeId &&
        (() => {
          const e = state.edges.find((x) => x.id === selectedEdgeId);
          if (!e) return null;
          const from = byId.get(e.from);
          const to = byId.get(e.to);
          if (!from || !to) return null;
          const mx = (center(from).cx + center(to).cx) / 2;
          const my = (from.y + NODE_H + to.y) / 2;
          return (
            <div
              className="edge-tools"
              style={{ left: mx - 38, top: my - 14 }}
              onClick={(ev) => ev.stopPropagation()}
            >
              <button
                className="edge-color"
                title="Cycle: automated / clean / person"
                style={{ background: EDGE_COLORS[e.kind] }}
                onClick={() => onCycleEdge(e.id)}
              >
                {e.kind[0].toUpperCase()}
              </button>
              <button
                className="edge-del"
                title="Delete connection"
                onClick={() => onDeleteEdge(e.id)}
              >
                ×
              </button>
            </div>
          );
        })()}

      {/* nodes */}
      {state.nodes.map((n) => {
        const meta = BLOCK_META[n.type];
        const isTarget = !!pending && pending.from !== n.id && hover === n.id;
        // task blocks show their short description; others show their label
        const text =
          n.type === "task" && n.description ? n.description : n.label;
        return (
          <div
            key={n.id}
            data-node-id={n.id}
            className={`node ${selectedId === n.id ? "selected" : ""} ${
              isTarget ? "drop-target" : ""
            }`}
            style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
            title={`${meta.label} ${n.id} — ${text}`}
            onMouseDown={(e) => startDrag(e, n)}
            onMouseUp={() => pending && dropConnect(n)}
            onMouseEnter={() => pending && setHover(n.id)}
            onMouseLeave={() => hover === n.id && setHover(null)}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(n.id);
              onSelectEdge(null);
            }}
          >
            <span className="node-icon" style={{ background: meta.color }}>
              {meta.icon}
            </span>

            {/* both handles can start a connection — drag from either to another block */}
            <span
              className="handle handle-in"
              title="Drag to connect"
              onMouseDown={(e) => startConnect(e, n)}
            />
            <span
              className="handle handle-out"
              title="Drag to connect"
              onMouseDown={(e) => startConnect(e, n)}
            />
          </div>
        );
      })}
    </div>
  );
}
