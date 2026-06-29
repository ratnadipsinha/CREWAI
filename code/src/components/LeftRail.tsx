import { BlockType, BLOCK_META } from "../types";
import { BlockIcon } from "./Icons";

const ORDER: BlockType[] = [
  "trigger",
  "agent",
  "task",
  "tool",
  "branch",
  "human",
  "end",
];

export function LeftRail({
  onAdd,
  onVibe,
}: {
  onAdd: (t: BlockType) => void;
  onVibe: () => void;
}) {
  return (
    <aside className="rail">
      <button
        className="rail-vibe"
        onClick={onVibe}
        title="Type or speak your idea — it builds the whole flow on the canvas"
      >
        <span className="rail-vibe-icon">🎙</span>
        <span className="rail-vibe-text">
          <b>Vibe your idea</b>
          <small>say or type it → canvas</small>
        </span>
      </button>

      <div className="rail-sep" />

      <div className="rail-title">ADD BLOCK</div>
      {ORDER.map((t) => (
        <button key={t} className="rail-item" onClick={() => onAdd(t)}>
          <span className="rail-icon" style={{ background: BLOCK_META[t].color }}>
            <BlockIcon type={t} size={18} />
          </span>
          <span>{BLOCK_META[t].label}</span>
        </button>
      ))}
    </aside>
  );
}
