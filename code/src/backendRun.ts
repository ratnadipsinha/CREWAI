// Client for the Python live-run backend (backend/server.py).
// Posts the canvas FlowState + credentials + LLM settings, then reads the NDJSON
// event stream so the Run panel can show each REAL step as it happens.

import { FlowState } from "./types";
import { CredStore } from "./credentials";
import { VibeSettings } from "./vibe";

export interface BackendEvent {
  type: "run" | "tools" | "step" | "done" | "error";
  run_id?: string;
  id?: string; // node id (step events)
  status?: "running" | "await" | "done" | "halted";
  detail?: string;
  output?: string;
  summary?: string;
  message?: string;
  tools?: { key: string; auth?: string; ready: boolean; missing?: string[] }[];
}

function base(settings: VibeSettings): string {
  return settings.backendUrl.replace(/\/$/, "");
}

export async function approveGate(
  settings: VibeSettings,
  runId: string,
  nodeId: string,
  approved: boolean,
): Promise<void> {
  await fetch(`${base(settings)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run_id: runId, node_id: nodeId, approved }),
  });
}

// Stream a real run. Calls onEvent for every NDJSON line the backend emits.
export async function streamRun(
  settings: VibeSettings,
  state: FlowState,
  creds: CredStore,
  onEvent: (ev: BackendEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${base(settings)}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      flow: state,
      credentials: creds,
      llm: {
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: settings.apiKey,
      },
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`backend ${res.status}: ${await res.text().catch(() => "")}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as BackendEvent);
    }
  }
  if (buf.trim()) onEvent(JSON.parse(buf.trim()) as BackendEvent);
}
