# Live-run backend (real CrewAI)

Turns the builder's **Run** from a dry run into a real one: the posted canvas is
executed as a genuine CrewAI crew — real agents driven by a real LLM, with real
tools resolved generically from each tool's auth schema.

## What's real

| Tool | Auth | Backend action |
|------|------|----------------|
| **Outlook** | OAuth (app-only / client credentials) | Reads the configured mailbox via Microsoft Graph |
| **Jira** | Basic (user + token) | Creates issues via REST |
| **HubSpot** | API key | Creates CRM records via REST |
| OCR | none | `FileReadTool` if `crewai-tools` is installed |
| Gmail | OAuth (user consent) | Stubbed — needs a user access token / MCP server |
| NetSuite | Token-based | Stubbed — needs TBA request signing |

Each tool is built by `tools_registry.py`, which reads its `auth` type and the
credential field names, **validates the credentials sent from the browser**, and
either builds the live tool or returns a clear "missing X" message. Add a new
tool by adding one entry + one builder there.

## Run it

```bash
cd backend
python -m venv .venv && .venv\Scripts\activate     # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # fill in Outlook + LLM defaults (see below)
python server.py            # http://localhost:8000
```

Then in the app: **⚙ settings → Live-run backend URL → `http://localhost:8000`**,
and click **▶ Run**.

## Credentials

Two sources, merged per run (browser value wins, env is fallback):

- **From the browser** — whatever you typed in the on-the-fly credential modals is
  posted with the run (over localhost) and used only for that run; never stored here.
- **From `backend/.env`** — server-side defaults. Outlook's `OUTLOOK_USER`
  (the mailbox to read, required in app-only mode) and the LLM keys live here.

### Outlook (Azure app registration)

App-only access needs the **application** permission `Mail.Read` with admin
consent, plus `OUTLOOK_USER` set to the mailbox to read.

### LLM

CrewAI needs a model to reason. Set `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`
in `.env` (any OpenAI-compatible provider; e.g. Groq's free tier), or let the
frontend's LLM settings drive it — they're sent with each run.

## Notes / limits

- Each task runs as its own single-task crew with prior outputs injected as
  context (mirrors the in-browser executor), so steps stream one at a time.
- Branch nodes take the clean path in the live run (the real conditional routing
  is in the exported `crew.py`).
- Human gates pause the stream and wait for **Approve/Reject** via `/approve`.
