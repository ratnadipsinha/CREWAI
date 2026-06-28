import { useState } from "react";
import { VibeSettings } from "../vibe";

// Simple AI-engine picker for "Vibe your idea". Three choices; the fiddly
// base-URL/model/key fields only appear for "Custom", and the pre-wired backend
// URL lives under Advanced.
type Engine = "template" | "groq" | "custom";

function engineOf(s: VibeSettings): Engine {
  if (s.provider === "template") return "template";
  if (s.baseUrl === "/llm") return "groq";
  return "custom";
}

export function SettingsModal({
  initial,
  onSave,
  onCancel,
}: {
  initial: VibeSettings;
  onSave: (s: VibeSettings) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState<VibeSettings>(initial);
  const engine = engineOf(s);

  function pick(next: Engine) {
    if (next === "template") {
      setS({ ...s, provider: "template" });
    } else if (next === "groq") {
      // built-in proxy — key lives server-side, nothing to enter
      setS({ ...s, provider: "openai", baseUrl: "/llm", model: "llama-3.3-70b-versatile" });
    } else {
      setS({
        ...s,
        provider: "openai",
        baseUrl: s.baseUrl === "/llm" ? "https://api.openai.com/v1" : s.baseUrl,
        model: s.model || "gpt-4o-mini",
      });
    }
  }

  const OPTIONS: { key: Engine; title: string; note: string }[] = [
    { key: "template", title: "Template", note: "Free · offline · no AI" },
    { key: "groq", title: "Groq (recommended)", note: "Built-in · no key needed" },
    { key: "custom", title: "Custom API", note: "Your OpenAI-compatible key" },
  ];

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal sched" onClick={(e) => e.stopPropagation()}>
        <h3>AI engine</h3>
        <p className="muted small">Powers “Vibe your idea” (turning your idea into the canvas).</p>

        <div className="engine-grid">
          {OPTIONS.map((o) => (
            <button
              key={o.key}
              className={`engine-card ${engine === o.key ? "active" : ""}`}
              onClick={() => pick(o.key)}
            >
              <b>{o.title}</b>
              <small>{o.note}</small>
            </button>
          ))}
        </div>

        {engine === "custom" && (
          <>
            <label className="field">
              <span>Base URL</span>
              <input
                value={s.baseUrl}
                placeholder="https://api.openai.com/v1"
                onChange={(e) => setS({ ...s, baseUrl: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Model</span>
              <input
                value={s.model}
                placeholder="gpt-4o-mini"
                onChange={(e) => setS({ ...s, model: e.target.value })}
              />
            </label>
            <label className="field">
              <span>API key</span>
              <input
                type="password"
                value={s.apiKey}
                placeholder="sk-..."
                onChange={(e) => setS({ ...s, apiKey: e.target.value })}
              />
            </label>
          </>
        )}

        <details className="advanced">
          <summary>Advanced</summary>
          <label className="field">
            <span>Live-run backend URL</span>
            <input
              value={s.backendUrl}
              placeholder="https://your-backend.onrender.com"
              onChange={(e) => setS({ ...s, backendUrl: e.target.value })}
            />
          </label>
          <p className="muted small">
            Pre-configured for deployment. Leave as-is unless you’re running your own backend.
          </p>
        </details>

        <div className="modal-actions">
          <div style={{ flex: 1 }} />
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" onClick={() => onSave(s)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
