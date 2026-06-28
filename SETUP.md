# Deploy your own copy

This repo contains **no secrets** — every API key lives in *your* hosting
dashboards, not the code. To run your own independent instance you provide your
own keys. ~10 minutes.

## 1. Backend (real CrewAI runs) → Render

The backend executes the crew, so it needs to run on a host that runs Python.

1. Fork/clone this repo to your GitHub.
2. [Render](https://render.com) → **New → Blueprint** → pick your repo (it reads
   [`render.yaml`](render.yaml) and builds `code/backend/Dockerfile`).
3. Set environment variables on the service:
   - `LLM_API_KEY` — your LLM key (free: <https://console.groq.com/keys>) **(required)**
   - `FRONTEND_ORIGIN` — your frontend origin, e.g. `https://<you>.github.io` (or `*` to test)
   - `LLM_BASE_URL` / `LLM_MODEL` — default to Groq; change for OpenAI/Gemini/etc.
4. Deploy → note the HTTPS URL, e.g. `https://<your-app>.onrender.com`.
   Verify: `https://<your-app>.onrender.com/health` → `{"ok": true}`.

> Tool credentials (Gmail, Outlook, Jira, HubSpot, MCP, …) are **not** set here —
> users enter them in the app's on-the-fly modals and they travel with each run.

## 2. Frontend → GitHub Pages

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Repo **Settings → Secrets and variables → Actions → Variables → New variable**:
   - `VITE_BACKEND_URL` = your Render URL from step 1.
   (This is injected at build time by [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml);
   it is intentionally **not** committed in `code/.env`.)
3. **Actions → Deploy to GitHub Pages → Run workflow** (or push to `main`).
4. Your site: `https://<you>.github.io/<repo>/`.

If you skip the variable, the app still works — users just paste the backend URL
into the app's ⚙ **Settings → Live-run backend URL** at runtime.

## 3. Local development

```bash
cd code
npm install
npm run dev            # http://localhost:3000
# set VITE_BACKEND_URL in code/.env.local (gitignored) to point at a backend
```

Backend locally:

```bash
cd code/backend
python -m venv .venv && .venv/Scripts/activate   # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # set LLM_API_KEY etc.
python server.py       # http://localhost:8000
```

## Secrets & sharing checklist

- ✅ No keys are committed; `.env.local` and `backend/.env` are gitignored.
- ✅ `code/.env` holds only public config (no real backend URL).
- ⚠️ The backend has **no auth** and `FRONTEND_ORIGIN=*` is open — anyone with the
  URL can spend your LLM quota. For shared/public use, add a token, restrict CORS,
  and set a spend cap on your LLM key.

## Tool notes

- **Outlook** uses app-only Microsoft Graph → needs a **Microsoft 365 Business**
  tenant with Exchange Online (personal M365 won't work).
- **Gmail** uses an OAuth **refresh token** (OAuth Playground) → works with a
  personal Gmail.
- **MCP Server (any)** → paste any MCP server URL; no per-service code needed.
