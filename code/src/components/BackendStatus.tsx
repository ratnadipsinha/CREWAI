import { useEffect, useState } from "react";

// Top-bar indicator: pings the live-run backend's /health so it's obvious at a
// glance whether real runs are available. No backend URL set => dry-run only.
type State = "none" | "checking" | "online" | "offline";

export function BackendStatus({ backendUrl }: { backendUrl: string }) {
  const url = backendUrl.trim().replace(/\/$/, "");
  const [state, setState] = useState<State>(url ? "checking" : "none");

  useEffect(() => {
    if (!url) {
      setState("none");
      return;
    }
    let alive = true;
    setState("checking");

    async function ping() {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(`${url}/health`, { signal: ctrl.signal });
        clearTimeout(t);
        if (alive) setState(res.ok ? "online" : "offline");
      } catch {
        if (alive) setState("offline");
      }
    }

    ping();
    const iv = setInterval(ping, 20000); // re-check periodically
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [url]);

  const meta: Record<State, { dot: string; text: string; title: string }> = {
    none: {
      dot: "#64748b",
      text: "Dry run",
      title: "No live-run backend configured — runs are simulated. Set one in Settings.",
    },
    checking: { dot: "#f59e0b", text: "Checking…", title: `Pinging ${url}/health` },
    online: {
      dot: "#22c55e",
      text: "Backend online",
      title: `Real runs available — ${url}`,
    },
    offline: {
      dot: "#ef4444",
      text: "Backend offline",
      title: `Can't reach ${url}/health — check the backend is running (free hosts cold-start).`,
    },
  };
  const m = meta[state];

  return (
    <span className="backend-status" title={m.title}>
      <span className="backend-dot" style={{ background: m.dot }} />
      {m.text}
    </span>
  );
}
