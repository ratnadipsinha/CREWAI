import { useState } from "react";
import { llmChat, VibeSettings } from "../vibe";

// Configure the LLM backend used for vibe-fill and live Run.
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
  const [test, setTest] = useState<string>("");
  const [testing, setTesting] = useState(false);

  async function runTest() {
    setTesting(true);
    setTest("");
    try {
      const out = await llmChat(s, "You are a test.", "Reply with exactly: OK");
      setTest(`✓ Connected — model replied: ${out.slice(0, 60)}`);
    } catch (e) {
      setTest(`✗ Failed: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  const presets = [
    // Recommended: routes through the dev-server proxy (/llm). Key lives in
    // .env.local, never in the browser; no CORS issues. Free with a Groq key.
    { label: "Proxy (free)", url: "/llm", model: "llama-3.3-70b-versatile" },
    { label: "OpenAI", url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    { label: "Groq", url: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
    { label: "Ollama (local)", url: "http://localhost:11434/v1", model: "qwen2.5-coder" },
  ];

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal sched" onClick={(e) => e.stopPropagation()}>
        <h3>LLM settings</h3>
        <p className="muted small">
          Used for vibe-fill and live Run. Any OpenAI-compatible endpoint works.
        </p>

        <label className="field">
          <span>Provider mode</span>
          <select
            value={s.provider}
            onChange={(e) => setS({ ...s, provider: e.target.value as any })}
          >
            <option value="template">Template (free, offline — no LLM)</option>
            <option value="ollama">Ollama (local)</option>
            <option value="openai">OpenAI-compatible API</option>
          </select>
        </label>

        <div className="field">
          <span>Quick presets</span>
          <div className="seg">
            {presets.map((p) => (
              <button
                key={p.label}
                className="seg-btn"
                onClick={() =>
                  setS({
                    ...s,
                    provider: p.label.startsWith("Ollama") ? "ollama" : "openai",
                    baseUrl: p.url,
                    model: p.model,
                  })
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

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
          <span>API key {s.provider === "ollama" && "(not needed for Ollama)"}</span>
          <input
            type="password"
            value={s.apiKey}
            placeholder="sk-..."
            onChange={(e) => setS({ ...s, apiKey: e.target.value })}
          />
        </label>

        <label className="field">
          <span>Live-run backend URL (optional)</span>
          <input
            value={s.backendUrl}
            placeholder="http://localhost:8000  (empty = in-browser dry run)"
            onChange={(e) => setS({ ...s, backendUrl: e.target.value })}
          />
        </label>
        <p className="muted small">
          Set this to the Python backend (see <code>backend/</code>) to make{" "}
          <b>Run</b> a real run — actual CrewAI agents and tools (Outlook, Jira,
          HubSpot…), with credentials sent only at run time.
        </p>

        <div className="modal-actions">
          <button className="ghost" onClick={runTest} disabled={testing || s.provider === "template"}>
            {testing ? "Testing…" : "Test connection"}
          </button>
          {test && <span className="muted small" style={{ flex: 1 }}>{test}</span>}
          {!test && <div style={{ flex: 1 }} />}
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" onClick={() => onSave(s)}>
            Save
          </button>
        </div>
        <p className="muted small">
          The API key is stored only in this browser (localStorage). It is sent
          directly to the endpoint you configure.
        </p>
      </div>
    </div>
  );
}
