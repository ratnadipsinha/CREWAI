import { useState } from "react";
import {
  ScheduleConfig,
  ScheduleMode,
  scheduleArtifacts,
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
  onSave,
  onCancel,
}: {
  initial: ScheduleConfig;
  onSave: (cfg: ScheduleConfig) => void;
  onCancel: () => void;
}) {
  const [cfg, setCfg] = useState<ScheduleConfig>(initial);
  const [os, setOs] = useState<OsKey>("windows");
  const art = scheduleArtifacts(cfg);

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
          Commands for <b>all</b> platforms are written to <code>SCHEDULE.md</code>{" "}
          in the exported project.
        </p>

        <div className="modal-actions">
          <div style={{ flex: 1 }} />
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" onClick={() => onSave(cfg)}>
            Save schedule
          </button>
        </div>
      </div>
    </div>
  );
}
