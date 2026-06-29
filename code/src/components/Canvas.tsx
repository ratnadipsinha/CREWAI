import { useRef, useState } from "react";
import { BLOCK_META, EDGE_COLORS, FlowState, Node } from "../types";
import { BlockIcon } from "./Icons";

const NODE_W = 52;
const NODE_H = 52;

function cx(node: Node) {
  return node.x + NODE_W / 2;
}

// Orthogonal connector (down → across → down) — straight segments, never curved.
function ortho(x1: number, y1: number, x2: number, y2: number): string {
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} L ${x1} ${my} L ${x2} ${my} L ${x2} ${y2}`;
}

interface Pending {
  from: string;
  x: number;
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
    return {
      x: clientX - r.left + canvasRef.current!.scrollLeft,
      y: clientY - r.top + canvasRef.current!.scrollTop,
    };
  }

  // --- drag a node (with a small threshold so a click doesn't jitter it) ---
  function startDrag(e: React.MouseEvent, node: Node) {
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const ox = node.x;
    const oy = node.y;
    let moved = false;
    function move(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      // light snap to the 11px grid
      onMove(
        node.id,
        Math.round((ox + dx) / 11) * 11,
        Math.round((oy + dy) / 11) * 11,
      );
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // --- drag a NEW connection from a handle ---
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
    if (pending && pending.from !== target.id) onAddEdge(pending.from, target.id);
    setPending(null);
    setHover(null);
  }

  const KINDS: { kind: keyof typeof EDGE_COLORS; color: string }[] = (
    Object.keys(EDGE_COLORS) as (keyof typeof EDGE_COLORS)[]
  ).map((k) => ({ kind: k, color: EDGE_COLORS[k] }));

  return (
    <div className="canvas" ref={canvasRef} onClick={() => onSelectEdge(null)}>
      <svg className="wires">
        <defs>
          {KINDS.map(({ kind, color }) => (
            <marker
              key={kind}
              id={`arr-${kind}`}
              markerWidth="10"
              markerHeight="10"
              refX="7"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L6,3 L0,6 Z" fill={color} />
            </marker>
          ))}
        </defs>

        {state.edges.map((e) => {
          const from = byId.get(e.from);
          const to = byId.get(e.to);
          if (!from || !to) return null;
          const isTool = from.type === "tool" || to.type === "tool";
          const color = EDGE_COLORS[e.kind];
          const selected = selectedEdgeId === e.id;

          // Tool attachment: a straight dashed grey line, no arrowhead.
          const d = isTool
            ? `M ${cx(from)} ${from.y + NODE_H / 2} L ${cx(to)} ${to.y + NODE_H / 2}`
            : ortho(cx(from), from.y + NODE_H, cx(to), to.y);

          return (
            <g key={e.id}>
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
                stroke={isTool ? "#94a3b8" : color}
                strokeWidth={selected ? 4 : 2.5}
                fill="none"
                strokeLinejoin="round"
                strokeDasharray={isTool ? "5 4" : selected ? "7 4" : undefined}
                markerEnd={isTool ? undefined : `url(#arr-${e.kind})`}
                style={{ pointerEvents: "none" }}
              />
            </g>
          );
        })}

        {pending &&
          (() => {
            const from = byId.get(pending.from)!;
            return (
              <path
                d={ortho(cx(from), from.y + NODE_H, pending.x, pending.y)}
                stroke="#0ea5e9"
                strokeWidth={2.5}
                strokeDasharray="5 5"
                fill="none"
              />
            );
          })()}
      </svg>

      {/* edge controls at midpoint of the selected edge */}
      {selectedEdgeId &&
        (() => {
          const e = state.edges.find((x) => x.id === selectedEdgeId);
          if (!e) return null;
          const from = byId.get(e.from);
          const to = byId.get(e.to);
          if (!from || !to) return null;
          const mx = (cx(from) + cx(to)) / 2;
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

      {/* nodes — small icon tiles */}
      {state.nodes.map((n) => {
        const meta = BLOCK_META[n.type];
        const isTarget = !!pending && pending.from !== n.id && hover === n.id;
        const text = n.type === "task" && n.description ? n.description : n.label;
        const toolKey = n.type === "tool" ? n.toolKey : undefined;
        return (
          <div
            key={n.id}
            data-node-id={n.id}
            className={`node ${selectedId === n.id ? "selected" : ""} ${
              isTarget ? "drop-target" : ""
            }`}
            style={{
              left: n.x,
              top: n.y,
              width: NODE_W,
              height: NODE_H,
              background: meta.color,
            }}
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
            <BlockIcon type={n.type} toolKey={toolKey} size={24} />
            <span className="node-tip">{text || meta.label}</span>

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
