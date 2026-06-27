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
}: {
  onAdd: (t: BlockType) => void;
  onDescribe: () => void;
}) {
  return (
    <aside className="rail">
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
        <span>Describe</span>
      </button>
    </aside>
  );
}
