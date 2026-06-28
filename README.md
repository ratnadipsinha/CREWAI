# Visual Agent Builder

A drag-and-drop, AI-assisted tool for composing **CrewAI** automations. Build a flow
of Triggers, Agents, Tasks, Tools, Branches, Human gates and End blocks on a canvas,
wire them with connectors, and get a real, runnable CrewAI project out the other end.

- **App:** [`code/`](code/) — Vite + React + TypeScript SPA
- **Backend:** [`code/backend/`](code/backend/) — FastAPI live-run service (real CrewAI)
- **Deploy your own copy:** see [`SETUP.md`](SETUP.md)

## Live link

Deployed to GitHub Pages via CI/CD on every push to `main`:

**https://ratnadipsinha.github.io/CREWAI/**

(Enable once under repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.)

## Features

- Icon-only canvas blocks with hover tooltips; flexible connectors (drag to create,
  click to recolor automated/clean/person, delete).
- **Describe → Build flow:** generate a whole end-to-end automation from one sentence.
- **Tools as blocks:** connect a Tool block to an agent; credentials prompted on the fly
  (Gmail, Outlook, Jira, HubSpot, NetSuite, OCR), stored only in the browser session.
- **Live code generation:** deterministic CrewAI Python, recomputed on every edit.
- **Branch → real `Flow`/`@router`** codegen; **Human gate** → approval block.
- **Run:** step-through execution (dry run, or live via an LLM); shows per-step outcomes.
- **Schedule:** generate cron / Task Scheduler / systemd / launchd / K8s CronJob.
- **Export:** download a runnable CrewAI project (`agents.py`, `tasks.py`, `tools.py`,
  `crew.py`, `main.py`, `requirements.txt`, `.env.example`, `SCHEDULE.md`).

## Run locally

```bash
cd code
npm install
npm run dev        # http://localhost:3000
```

### Optional: live LLM (vibe-fill + live Run)
The dev server proxies `/llm` to an OpenAI-compatible API so the key stays server-side.
Copy `code/.env.local.example` to `code/.env.local` and set a key (e.g. a free Groq key),
then in the app: ⚙ → preset **Proxy (free)** → Test → Save.

> Note: the `/llm` proxy is a **dev-server** feature. The GitHub Pages build is static —
> live Run there needs a directly reachable API; the template (dry-run) mode always works.
