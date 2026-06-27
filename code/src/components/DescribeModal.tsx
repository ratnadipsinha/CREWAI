import { useState } from "react";
import { BlockType, BLOCK_META } from "../types";

const TYPES: BlockType[] = ["agent", "task", "trigger", "branch", "human"];

export type DescribeMode = "flow" | "block";

// Describe-and-generate.
//  - "flow"  : build a complete end-to-end automation (trigger + agents + tasks +
//              branches + human gate), wired together.
//  - "block" : draft a single block of the chosen type.
// Redescribing an existing node forces "block" mode.
export function DescribeModal({
  initialType,
  lockBlock,
  busy,
  onGenerate,
  onCancel,
}: {
  initialType: BlockType;
  lockBlock: boolean; // true when redescribing a node
  busy: boolean;
  onGenerate: (mode: DescribeMode, type: BlockType, prompt: string) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<DescribeMode>(lockBlock ? "block" : "flow");
  const [type, setType] = useState<BlockType>(initialType);
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);

  function speak() {
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert("Speech recognition not supported in this browser.");
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.onresult = (e: any) =>
      setText((t) => (t ? t + " " : "") + e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  }

  const placeholder =
    mode === "flow"
      ? 'e.g. "When an invoice email arrives, read it from Gmail, run OCR to extract fields, validate the vendor and PO, record clean ones to HubSpot, prepare the payment, and require a person to approve before paying"'
      : 'e.g. "a researcher that reads competitor invoices from Gmail"';

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Describe and generate</h3>

        {!lockBlock && (
          <div className="seg">
            <button
              className={`seg-btn ${mode === "flow" ? "active" : ""}`}
              onClick={() => setMode("flow")}
            >
              🧩 End-to-end flow
            </button>
            <button
              className={`seg-btn ${mode === "block" ? "active" : ""}`}
              onClick={() => setMode("block")}
            >
              ◻ Single block
            </button>
          </div>
        )}

        {mode === "block" && (
          <div className="type-row">
            {TYPES.map((t) => (
              <button
                key={t}
                className={`chip ${type === t ? "active" : ""}`}
                onClick={() => setType(t)}
                disabled={lockBlock}
              >
                {BLOCK_META[t].icon} {BLOCK_META[t].label}
              </button>
            ))}
          </div>
        )}

        {mode === "flow" && (
          <p className="muted small">
            Describe the whole automation — what triggers it, the steps, and where a
            person must approve. The builder lays out the trigger, agents, tasks,
            branches, and human gates, and wires them together.
          </p>
        )}

        <textarea rows={5} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />

        <div className="modal-actions">
          <button className={`ghost ${listening ? "rec" : ""}`} onClick={speak}>
            🎙 {listening ? "Listening…" : "Speak"}
          </button>
          <div style={{ flex: 1 }} />
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={!text.trim() || busy}
            onClick={() => onGenerate(mode, type, text.trim())}
          >
            {busy ? "Generating…" : mode === "flow" ? "Build flow" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  );
}
