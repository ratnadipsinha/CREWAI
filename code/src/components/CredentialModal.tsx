import { useState } from "react";
import { CredStore } from "../credentials";
import { TOOLS } from "../tools";
import { backendHeaders } from "../backendRun";

// Prompted on the fly the instant a tool is attached to an agent. Asks only for
// that tool's fields. Values go to the in-memory CredStore, never the FlowState.
export function CredentialModal({
  toolKey,
  creds,
  backendUrl,
  onSave,
  onCancel,
}: {
  toolKey: string;
  creds: CredStore;
  backendUrl?: string;
  onSave: (values: CredStore) => void;
  onCancel: () => void;
}) {
  const tool = TOOLS[toolKey];
  const [values, setValues] = useState<CredStore>(() => {
    const init: CredStore = {};
    tool.fields.forEach((f) => (init[f.name] = creds[f.name] ?? ""));
    return init;
  });
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function runTest() {
    const base = (backendUrl || "").trim().replace(/\/$/, "");
    if (!base) {
      setTestMsg({ ok: false, text: "Set a live-run backend URL in Settings to test login." });
      return;
    }
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await fetch(`${base}/test-tool`, {
        method: "POST",
        headers: backendHeaders(),
        body: JSON.stringify({ toolKey, credentials: values }),
      });
      const data = await res.json();
      setTestMsg({ ok: !!data.ok, text: data.message || (data.ok ? "OK" : "Failed") });
    } catch (e) {
      setTestMsg({ ok: false, text: `Could not reach backend: ${(e as Error).message}` });
    } finally {
      setTesting(false);
    }
  }

  if (tool.auth === "none") {
    // no credentials needed — auto-confirm
    onSave({});
    return null;
  }

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          Connect {tool.label} <span className="tag">{tool.auth}</span>
        </h3>
        <p className="muted">{tool.description}</p>
        {tool.fields.map((f) => (
          <label key={f.name} className="field">
            <span>{f.label}</span>
            <input
              type={f.secret ? "password" : "text"}
              value={values[f.name]}
              placeholder={f.name}
              onChange={(e) =>
                setValues({ ...values, [f.name]: e.target.value })
              }
            />
          </label>
        ))}
        <p className="muted small">
          Stored only in this browser session as env vars. Never written into the
          generated code — export ships a <code>.env.example</code> with names only.
        </p>
        {testMsg && (
          <p className={`test-result ${testMsg.ok ? "ok" : "fail"}`}>
            {testMsg.ok ? "✓ " : "✗ "}
            {testMsg.text}
          </p>
        )}

        <div className="modal-actions">
          <button
            className="ghost"
            onClick={runTest}
            disabled={testing || tool.fields.some((f) => !f.optional && !values[f.name].trim())}
            title="Verify these credentials against the live backend"
          >
            {testing ? "Testing…" : "Test login"}
          </button>
          <div style={{ flex: 1 }} />
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={() => onSave(values)}
            disabled={tool.fields.some((f) => !f.optional && !values[f.name].trim())}
          >
            Save & attach
          </button>
        </div>
      </div>
    </div>
  );
}
