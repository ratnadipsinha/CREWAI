import { useState } from "react";
import { CredStore } from "../credentials";
import { TOOLS } from "../tools";

// Prompted on the fly the instant a tool is attached to an agent. Asks only for
// that tool's fields. Values go to the in-memory CredStore, never the FlowState.
export function CredentialModal({
  toolKey,
  creds,
  onSave,
  onCancel,
}: {
  toolKey: string;
  creds: CredStore;
  onSave: (values: CredStore) => void;
  onCancel: () => void;
}) {
  const tool = TOOLS[toolKey];
  const [values, setValues] = useState<CredStore>(() => {
    const init: CredStore = {};
    tool.fields.forEach((f) => (init[f.name] = creds[f.name] ?? ""));
    return init;
  });

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
        <div className="modal-actions">
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={() => onSave(values)}
            disabled={tool.fields.some((f) => !values[f.name].trim())}
          >
            Save & attach
          </button>
        </div>
      </div>
    </div>
  );
}
