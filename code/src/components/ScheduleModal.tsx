import { useState } from "react";
import {
  ScheduleConfig,
  ScheduleMode,
  scheduleArtifacts,
  taskName,
} from "../schedule";

const MODES: { key: ScheduleMode; label: string }[] = [
  { key: "interval", label: "Every N minutes" },
  { key: "hourly", label: "Hourly" },
  { key: "daily", label: "Daily at time" },
  { key: "cron", label: "Custom cron" },
];

type OsKey = "windows" | "cron" | "systemd" | "macos" | "k8s";
const OS_OPTIONS: { key: OsKey; label: string }[] = [
  { key: "windows", label: "Windows (Task Scheduler)" },
  { key: "cron", label: "Linux / macOS (cron)" },
  { key: "systemd", label: "Linux (systemd timer)" },
  { key: "macos", label: "macOS (launchd)" },
  { key: "k8s", label: "Kubernetes (CronJob)" },
];

// Configure a recurring schedule and preview the generated OS-specific commands.
// The saved config ships in the exported project's SCHEDULE.md.
export function ScheduleModal({
  initial,
  projectName,
  canScheduleLive,
  onSave,
  onScheduleLive,
  onCancel,
}: {
  initial: ScheduleConfig;
  projectName?: string;
  canScheduleLive?: boolean; // backend set + canvas not empty
  onSave: (cfg: ScheduleConfig) => void;
  onScheduleLive?: (cfg: ScheduleConfig) => Promise<{ next_run: string | null }>;
  onCancel: () => void;
}) {
  const [cfg, setCfg] = useState<ScheduleConfig>(initial);
  const [os, setOs] = useState<OsKey>("windows");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const art = scheduleArtifacts(cfg, projectName);

  async function scheduleLive() {
    if (!onScheduleLive) return;
    setBusy(true);
    setMsg(null);
    try {
      const rec = await onScheduleLive(cfg);
      setMsg({ ok: true, text: `Scheduled ✓ — next run: ${rec.next_run ?? "(pending)"}` });
    } catch (e) {
      setMsg({ ok: false, text: `Schedule failed: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  const osCommand: Record<OsKey, string> = {
    windows: art.windows,
    cron: art.linuxCron,
    systemd: `# /etc/systemd/system/crew-runner.service\n${art.systemdService}\n\n# /etc/systemd/system/crew-runner.timer\n${art.systemdTimer}\n\n# systemctl enable --now crew-runner.timer`,
    macos: `# ~/Library/LaunchAgents/com.crew.runner.plist\n${art.macosLaunchd}\n\n# launchctl load ~/Library/LaunchAgents/com.crew.runner.plist`,
    k8s: art.k8s,
  };

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal sched" onClick={(e) => e.stopPropagation()}>
        <h3>Schedule the crew</h3>
        <p className="muted small">
          OS scheduler job name: <code>{taskName(projectName)}</code>
        </p>

        <div className="seg">
          {MODES.map((m) => (
            <button
              key={m.key}
              className={`seg-btn ${cfg.mode === m.key ? "active" : ""}`}
              onClick={() => setCfg({ ...cfg, mode: m.key })}
            >
              {m.label}
            </button>
          ))}
        </div>

        {cfg.mode === "interval" && (
          <label className="field">
            <span>Run every (minutes)</span>
            <input
              type="number"
              min={1}
              value={cfg.everyMinutes}
              onChange={(e) =>
                setCfg({ ...cfg, everyMinutes: Number(e.target.value) })
              }
            />
          </label>
        )}
        {cfg.mode === "daily" && (
          <label className="field">
            <span>Time (HH:MM)</span>
            <input
              type="time"
              value={cfg.time}
              onChange={(e) => setCfg({ ...cfg, time: e.target.value })}
            />
          </label>
        )}
        {cfg.mode === "cron" && (
          <label className="field">
            <span>Cron expression</span>
            <input
              value={cfg.cron}
              placeholder="0 8 * * 1-5"
              onChange={(e) => setCfg({ ...cfg, cron: e.target.value })}
            />
          </label>
        )}

        <label className="field">
          <span>Target OS / platform</span>
          <select value={os} onChange={(e) => setOs(e.target.value as OsKey)}>
            {OS_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div className="sched-preview">
          <div className="muted small">
            Cron: <code>{art.cron}</code> · {art.summary}
          </div>
          <div className="sched-block">
            <span className="muted small">
              {OS_OPTIONS.find((o) => o.key === os)!.label}
            </span>
            <pre>{osCommand[os]}</pre>
          </div>
        </div>

        <p className="muted small">
          <b>Schedule on backend</b> actually runs the crew on this interval (headless,
          human gates auto-approved). The commands below are also written to{" "}
          <code>SCHEDULE.md</code> for running the exported project yourself.
        </p>

        {msg && (
          <p className={`test-result ${msg.ok ? "ok" : "fail"}`}>{msg.text}</p>
        )}

        <div className="modal-actions">
          <div style={{ flex: 1 }} />
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="ghost" onClick={() => onSave(cfg)} title="Save the cadence for export only">
            Save for export
          </button>
          <button
            className="primary"
            onClick={scheduleLive}
            disabled={busy || !canScheduleLive}
            title={
              canScheduleLive
                ? "Register this schedule on the live backend"
                : "Set a backend URL in Settings and add blocks to the canvas first"
            }
          >
            {busy ? "Scheduling…" : "Schedule on backend"}
          </button>
        </div>
      </div>
    </div>
  );
}
