// Schedule the exported crew to run on a regular interval. The builder doesn't
// run a scheduler itself — it generates the cron expression and the OS-specific
// commands (Windows Task Scheduler, cron, systemd timer, Kubernetes CronJob),
// which ship in the exported project's SCHEDULE.md.

export type ScheduleMode = "interval" | "hourly" | "daily" | "cron";

export interface ScheduleConfig {
  mode: ScheduleMode;
  everyMinutes: number; // interval mode
  time: string; // "HH:MM" for daily
  cron: string; // raw cron for cron mode
}

export const DEFAULT_SCHEDULE: ScheduleConfig = {
  mode: "interval",
  everyMinutes: 15,
  time: "08:00",
  cron: "0 8 * * *",
};

export function toCron(cfg: ScheduleConfig): string {
  switch (cfg.mode) {
    case "interval": {
      const n = Math.max(1, Math.floor(cfg.everyMinutes));
      return n % 60 === 0 ? `0 */${n / 60} * * *` : `*/${n} * * * *`;
    }
    case "hourly":
      return "0 * * * *";
    case "daily": {
      const [h, m] = cfg.time.split(":");
      return `${parseInt(m || "0", 10)} ${parseInt(h || "0", 10)} * * *`;
    }
    case "cron":
      return cfg.cron.trim();
  }
}

export function humanSummary(cfg: ScheduleConfig): string {
  switch (cfg.mode) {
    case "interval":
      return `every ${cfg.everyMinutes} minute(s)`;
    case "hourly":
      return "every hour";
    case "daily":
      return `daily at ${cfg.time}`;
    case "cron":
      return `cron: ${cfg.cron}`;
  }
}

export interface ScheduleArtifacts {
  cron: string;
  summary: string;
  windows: string;
  linuxCron: string;
  systemdService: string;
  systemdTimer: string;
  macosLaunchd: string;
  k8s: string;
}

// Scheduled jobs are named "Agent-<project name>" in every OS scheduler.
export function taskName(projectName?: string): string {
  const slug =
    (projectName || "crew")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "crew";
  return `Agent-${slug}`;
}

export function scheduleArtifacts(
  cfg: ScheduleConfig,
  projectName?: string,
): ScheduleArtifacts {
  const cron = toCron(cfg);
  const name = taskName(projectName); // e.g. "Agent-billing-bot"
  const unit = name.toLowerCase(); // systemd/k8s want lowercase

  // Windows Task Scheduler — task appears as "Agent-<project>"
  let windows: string;
  if (cfg.mode === "interval") {
    windows = `schtasks /create /tn "${name}" /tr "python C:\\path\\to\\main.py" /sc minute /mo ${cfg.everyMinutes}`;
  } else if (cfg.mode === "hourly") {
    windows = `schtasks /create /tn "${name}" /tr "python C:\\path\\to\\main.py" /sc hourly`;
  } else if (cfg.mode === "daily") {
    windows = `schtasks /create /tn "${name}" /tr "python C:\\path\\to\\main.py" /sc daily /st ${cfg.time}`;
  } else {
    windows = `# Custom cron isn't directly supported by schtasks.\n# Use daily/minute flags, or run via WSL cron.\n# (task name: ${name})`;
  }

  const linuxCron = `${cron} cd /path/to/crew && /usr/bin/python3 main.py >> /var/log/${unit}.log 2>&1  # ${name}`;

  const systemdService = [
    "[Unit]",
    `Description=${name} (CrewAI Runner)`,
    "",
    "[Service]",
    "Type=oneshot",
    "ExecStart=/usr/bin/python3 /path/to/crew/main.py",
    "WorkingDirectory=/path/to/crew",
  ].join("\n");

  const systemdTimer = [
    "[Unit]",
    `Description=${name} schedule`,
    "",
    "[Timer]",
    `OnCalendar=${onCalendar(cfg)}`,
    "Persistent=true",
    "",
    "[Install]",
    "WantedBy=timers.target",
  ].join("\n");

  const k8s = [
    "apiVersion: batch/v1",
    "kind: CronJob",
    "metadata:",
    `  name: ${unit}`,
    "spec:",
    `  schedule: "${cron}"`,
    "  jobTemplate:",
    "    spec:",
    "      template:",
    "        spec:",
    "          restartPolicy: OnFailure",
    "          containers:",
    `            - name: ${unit}`,
    "              image: your-registry/crew:latest",
    '              command: ["python", "main.py"]',
  ].join("\n");

  return {
    cron,
    summary: humanSummary(cfg),
    windows,
    linuxCron,
    systemdService,
    systemdTimer,
    macosLaunchd: macosPlist(cfg, name),
    k8s,
  };
}

function macosPlist(cfg: ScheduleConfig, name = "Agent-crew"): string {
  const label = "com." + name.toLowerCase().replace(/[^a-z0-9]+/g, ".");
  let when: string;
  if (cfg.mode === "interval") {
    when = `    <key>StartInterval</key>\n    <integer>${cfg.everyMinutes * 60}</integer>`;
  } else if (cfg.mode === "hourly") {
    when =
      "    <key>StartCalendarInterval</key>\n    <dict><key>Minute</key><integer>0</integer></dict>";
  } else if (cfg.mode === "daily") {
    const [h, m] = cfg.time.split(":");
    when = `    <key>StartCalendarInterval</key>\n    <dict><key>Hour</key><integer>${parseInt(h || "0", 10)}</integer><key>Minute</key><integer>${parseInt(m || "0", 10)}</integer></dict>`;
  } else {
    when =
      "    <key>StartCalendarInterval</key>\n    <dict><!-- map your cron to Hour/Minute/Weekday --></dict>";
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<plist version="1.0">',
    "  <dict>",
    "    <key>Label</key>",
    `    <string>${label}</string>`,
    "    <key>ProgramArguments</key>",
    "    <array><string>/usr/bin/python3</string><string>/path/to/crew/main.py</string></array>",
    when,
    "    <key>StandardOutPath</key>",
    `    <string>/tmp/${name.toLowerCase()}.log</string>`,
    "  </dict>",
    "</plist>",
  ].join("\n");
}

function onCalendar(cfg: ScheduleConfig): string {
  switch (cfg.mode) {
    case "interval":
      return `*:0/${cfg.everyMinutes}`; // every N minutes
    case "hourly":
      return "hourly";
    case "daily":
      return `*-*-* ${cfg.time}:00`;
    case "cron":
      return "daily  # adjust to match your cron";
  }
}

export function scheduleMarkdown(cfg: ScheduleConfig, projectName?: string): string {
  const a = scheduleArtifacts(cfg, projectName);
  const unit = taskName(projectName).toLowerCase(); // e.g. agent-billing-bot
  const label = "com." + taskName(projectName).toLowerCase().replace(/[^a-z0-9]+/g, ".");
  return [
    "# Schedule",
    "",
    `Job name: **${taskName(projectName)}**`,
    `Run cadence: **${a.summary}**`,
    `Cron expression: \`${a.cron}\``,
    "",
    "## Windows (Task Scheduler)",
    "```",
    a.windows,
    "```",
    "",
    "## Linux / macOS (cron)",
    "Add to `crontab -e`:",
    "```",
    a.linuxCron,
    "```",
    "",
    "## Linux (systemd timer)",
    `\`/etc/systemd/system/${unit}.service\`:`,
    "```ini",
    a.systemdService,
    "```",
    `\`/etc/systemd/system/${unit}.timer\`:`,
    "```ini",
    a.systemdTimer,
    "```",
    `Enable: \`systemctl enable --now ${unit}.timer\``,
    "",
    "## macOS (launchd)",
    `\`~/Library/LaunchAgents/${label}.plist\`:`,
    "```xml",
    a.macosLaunchd,
    "```",
    `Load: \`launchctl load ~/Library/LaunchAgents/${label}.plist\``,
    "",
    "## Kubernetes (CronJob)",
    "```yaml",
    a.k8s,
    "```",
    "",
  ].join("\n");
}
