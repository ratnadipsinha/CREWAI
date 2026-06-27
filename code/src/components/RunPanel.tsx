import { useEffect, useRef, useState } from "react";
import { FlowState } from "../types";
import { describe, runOrder, RunStep } from "../runner";
import { executeStep } from "../executor";
import { VibeSettings } from "../vibe";
import { CredStore } from "../credentials";
import { approveGate, BackendEvent, streamRun } from "../backendRun";

// Runs the flow step-by-step. Three modes:
//   - backend URL set  -> REAL run: Python backend runs CrewAI with real tools.
//   - Ollama/API only  -> live LLM reasoning in-browser (tools NOT actually called).
//   - template engine  -> dry run with mock outcomes.
// Pauses at a human gate for Approve / Reject in every mode.
export function RunPanel({
  state,
  settings,
  creds,
  onClose,
}: {
  state: FlowState;
  settings: VibeSettings;
  creds: CredStore;
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
  const [summary, setSummary] = useState<string>("");
  const [toolStatus, setToolStatus] = useState<BackendEvent["tools"]>();
  const approver = useRef<((ok: boolean) => void) | null>(null);
  const started = useRef(false);

  const useBackend = !!settings.backendUrl.trim();
  const live = settings.provider !== "template";

  const idIndex = useRef(new Map(order.map((n, i) => [n.id, i]))).current;
  function setStep(i: number, patch: Partial<RunStep>) {
    setSteps((s) => s.map((st, k) => (k === i ? { ...st, ...patch } : st)));
  }
  function setStepById(id: string, patch: Partial<RunStep>) {
    const i = idIndex.get(id);
    if (i !== undefined) setStep(i, patch);
  }

  // ---- REAL run via the Python backend ----
  useEffect(() => {
    if (!useBackend || started.current || order.length === 0) return;
    started.current = true;
    const ctrl = new AbortController();
    let runId = "";
    let gateNode = "";

    function onEvent(ev: BackendEvent) {
      switch (ev.type) {
        case "run":
          runId = ev.run_id || "";
          break;
        case "tools":
          setToolStatus(ev.tools);
          break;
        case "step":
          if (ev.status === "await") {
            gateNode = ev.id || "";
            setStepById(ev.id!, { status: "await" });
            setAwaiting(true);
            approver.current = async (ok: boolean) => {
              setAwaiting(false);
              await approveGate(settings, runId, gateNode, ok);
            };
          } else {
            setStepById(ev.id!, {
              status: ev.status!,
              ...(ev.output !== undefined ? { output: ev.output } : {}),
            });
          }
          break;
        case "done":
          setSummary(ev.summary || "");
          setFinished(true);
          break;
        case "error":
          setSummary(`Backend error: ${ev.message}`);
          setFinished(true);
          break;
      }
    }

    streamRun(settings, state, creds, onEvent, ctrl.signal).catch((e) => {
      setSummary(`Could not reach backend: ${(e as Error).message}`);
      setFinished(true);
    });
    return () => ctrl.abort();
  }, [useBackend, order, settings, state, creds]);

  // ---- in-browser run (dry run / live LLM reasoning) ----
  useEffect(() => {
    if (useBackend || started.current || order.length === 0) return;
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
  }, [useBackend, order, settings, state]);

  const lastDone = [...steps].reverse().find((s) => s.status === "done");
  const halted = steps.some((s) => s.status === "halted");

  const mode = useBackend
    ? `Real run — CrewAI backend${settings.model ? ` (${settings.model})` : ""}`
    : live
      ? `Run (live — ${settings.model})`
      : "Run (dry run)";
  const modeNote = useBackend
    ? "— real agents, real tools, executed by the Python backend"
    : live
      ? "— agents driven through the LLM; tools are not actually called"
      : "— mock outcomes; switch engine to Ollama/API, or set a backend URL for a real run";

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal run" onClick={(e) => e.stopPropagation()}>
        <h3>
          {mode} <span className="muted small">{modeNote}</span>
        </h3>

        {order.length === 0 && <p className="muted">Nothing to run — the canvas is empty.</p>}

        {toolStatus && toolStatus.length > 0 && (
          <div className="tool-status">
            {toolStatus.map((t) => (
              <span key={t.key} className={`tool-pill ${t.ready ? "ok" : "missing"}`}>
                {t.ready ? "✓" : "•"} {t.key}
                {!t.ready && t.missing?.length ? ` (needs ${t.missing.join(", ")})` : ""}
              </span>
            ))}
          </div>
        )}

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
              {summary || (halted ? "No downstream actions were taken." : lastDone?.output ?? "(no output)")}
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
