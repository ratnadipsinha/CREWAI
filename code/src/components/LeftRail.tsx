import { BlockType, BLOCK_META } from "../types";

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
  onDescribe,
  onVibe,
}: {
  onAdd: (t: BlockType) => void;
  onDescribe: () => void;
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
            {BLOCK_META[t].icon}
          </span>
          <span>{BLOCK_META[t].label}</span>
        </button>
      ))}
      <button className="rail-item describe" onClick={onDescribe}>
        <span className="rail-icon" style={{ background: "#0ea5e9" }}>
          ✨
        </span>
        <span>Describe a block</span>
      </button>
    </aside>
  );
}
