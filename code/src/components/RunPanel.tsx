import { useEffect, useRef, useState } from "react";
import { FlowState } from "../types";
import { describe, runOrder, RunStep } from "../runner";
import { executeStep } from "../executor";
import { VibeSettings } from "../vibe";

// Runs the flow step-by-step. With Ollama/API selected it drives the agents
// through the LLM and shows real output; with the template engine it's a dry run.
// Pauses at a human gate for Approve / Reject.
export function RunPanel({
  state,
  settings,
  onClose,
}: {
  state: FlowState;
  settings: VibeSettings;
  onClose: () => void;
}) {
  const order = useRef(runOrder(state)).current;
  const [steps, setSteps] = useState<RunStep[]>(
    order.map((n) => {
      const d = describe(n);
      return { id: n.id, icon: d.icon, title: d.title, detail: d.detail, status: "pending" };
    }),
  );
  const [awaiting, setAwaiting] = useState(false);
  const [finished, setFinished] = useState(order.length === 0);
  const approver = useRef<((ok: boolean) => void) | null>(null);
  const started = useRef(false);

  const live = settings.provider !== "template";

  function setStep(i: number, patch: Partial<RunStep>) {
    setSteps((s) => s.map((st, k) => (k === i ? { ...st, ...patch } : st)));
  }

  useEffect(() => {
    if (started.current || order.length === 0) return;
    started.current = true;

    (async () => {
      let context = "";
      for (let i = 0; i < order.length; i++) {
        const node = order[i];
        setStep(i, { status: "running" });

        if (node.type === "human") {
          setStep(i, { status: "await" });
          setAwaiting(true);
          const ok = await new Promise<boolean>((res) => (approver.current = res));
          setAwaiting(false);
          if (!ok) {
            setStep(i, { status: "halted", output: "rejected by user" });
            setFinished(true);
            return;
          }
          setStep(i, { status: "done", output: "approved by user" });
          context += "\n[human approved]";
          continue;
        }

        let out = "";
        try {
          out = await executeStep(settings, node, state, context);
        } catch (e) {
          out = `error: ${(e as Error).message}`;
        }
        setStep(i, { status: "done", output: out });
        context += `\n${describe(node).title}: ${out}`;
      }
      setFinished(true);
    })();
  }, [order, settings, state]);

  const lastDone = [...steps].reverse().find((s) => s.status === "done");
  const halted = steps.some((s) => s.status === "halted");

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal run" onClick={(e) => e.stopPropagation()}>
        <h3>
          {live ? `Run (live — ${settings.model})` : "Run (dry run)"}{" "}
          <span className="muted small">
            {live
              ? "— agents driven through the LLM; tools are not actually called"
              : "— mock outcomes; switch engine to Ollama/API for a live run"}
          </span>
        </h3>

        {order.length === 0 && <p className="muted">Nothing to run — the canvas is empty.</p>}

        <div className="run-log">
          {steps.map((s) => (
            <div key={s.id} className={`run-step ${s.status}`}>
              <span className="run-icon">{s.icon}</span>
              <div className="run-body">
                <div className="run-title">
                  {s.title} <span className="run-id">{s.id}</span>
                </div>
                {s.detail && <div className="run-detail">{s.detail}</div>}
                {s.output && <div className="run-output">→ {s.output}</div>}
              </div>
              <span className="run-status">
                {s.status === "running" && "…"}
                {s.status === "done" && "✓"}
                {s.status === "await" && "⏸"}
                {s.status === "halted" && "✗"}
              </span>
            </div>
          ))}
        </div>

        {awaiting && (
          <div className="run-gate">
            <span>Authorization required before continuing.</span>
            <button className="primary" onClick={() => approver.current?.(true)}>
              Approve
            </button>
            <button className="danger" onClick={() => approver.current?.(false)}>
              Reject
            </button>
          </div>
        )}

        {finished && (
          <div className={`run-outcome ${halted ? "halted" : "ok"}`}>
            <div className="run-outcome-head">
              {halted ? "✗ Run halted — not approved" : "✓ Run complete — outcome"}
            </div>
            <div className="run-outcome-body">
              {halted
                ? "No downstream actions were taken."
                : lastDone?.output ?? "(no output)"}
            </div>
          </div>
        )}

        <div className="modal-actions">
          <div style={{ flex: 1 }} />
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
