# Visual Agent Builder

A drag-and-drop, AI-assisted tool for composing **CrewAI** automations. Drag blocks
onto the canvas (Trigger, Agent, Task, Tool, Branch, Human step), wire them together,
and get a real, runnable CrewAI project out the other end.

Built to the architecture in `../../Document/Visual_Agent_Builder_Build_Deploy_Run.md`.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
```

The app opens pre-seeded with the **billing-automation** example (invoice email →
read → extract → validate → route → record / prepare payment → human authorization gate).

## What it does

- **Canvas** — numbered nodes (1.0, 2.0, …) with colored bezier connectors
  (purple = automated, green = clean path, pink = needs a person) and a legend.
- **Describe-and-generate (vibe-fill)** — click **Describe** (or **Redescribe** on a
  node), type or speak what a block should do, hit **Generate**, and its fields are drafted.
- **Live code generation** — the right panel shows the generated CrewAI Python,
  recomputed on every edit. It is a pure function of the canvas (see `src/codegen.ts`) —
  no LLM, instant.
- **On-the-fly tool credentials** — attach a tool to an agent and the builder
  immediately prompts for exactly that tool's credentials (Gmail OAuth, Jira ID+token,
  HubSpot/NetSuite API keys). Secrets stay in the browser session as env vars; they
  never enter the canvas state or the generated code.
- **Export** — download a real CrewAI project (`agents.py`, `tasks.py`, `tools.py`,
  `crew.py`, `main.py`, `requirements.txt`, `.env.example`) as a `.zip`.

## Vibe-fill engine (top-right selector)

| Mode | Cost | Notes |
|------|------|-------|
| **Template** | $0 | Deterministic keyword fallback. Offline, always works. Default. |
| **Ollama** | $0 | Local model via `http://localhost:11434/v1` (e.g. `qwen2.5-coder`). Private. |
| **API key** | per-token | Any OpenAI-compatible endpoint (Claude proxy / OpenAI). |

Any LLM call automatically falls back to the template engine if the endpoint is
unreachable — vibe-fill never blocks the UI.

## Structure

```
src/
  types.ts          canvas data model (single source of truth)
  tools.ts          tool catalog + per-tool credential schemas
  vibe.ts           pluggable vibe-fill adapter (template / ollama / api)
  codegen.ts        deterministic FlowState -> CrewAI Python (pure functions)
  exporter.ts       zip the generated project
  credentials.ts    on-the-fly credential store (session-only)
  billingExample.ts pre-seeded canvas
  components/        LeftRail, Canvas, Legend, NodeCard, CodePanel, modals
```
