"""FastAPI backend: runs a real CrewAI crew from the canvas and streams steps.

Endpoints:
  GET  /health          -> liveness
  POST /run             -> NDJSON stream of step events (one JSON object per line)
  POST /approve         -> resolve a pending human-approval gate

The browser posts { flow, credentials, llm }. Credentials are the values the user
typed in the on-the-fly modals (keyed by env-var name); they're used for this run
only and never persisted here.
"""
from __future__ import annotations

import asyncio
import json
import os
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, Request, Header, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse

load_dotenv()

app = FastAPI(title="Visual Agent Builder — live run backend")


# Optional shared-token auth. Enforced ONLY when BACKEND_TOKEN is set on the
# server — unset means fully open (unchanged behavior). /health and /version stay
# open so the status pill works without a token.
def require_token(x_api_token: str = Header(default="")):
    expected = os.environ.get("BACKEND_TOKEN", "").strip()
    if expected and x_api_token != expected:
        raise HTTPException(status_code=401, detail="invalid or missing API token")

# FRONTEND_ORIGIN may be a comma-separated list, or "*" to allow any origin.
_origins_env = os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000").strip()
_origins = ["*"] if _origins_env == "*" else [o.strip() for o in _origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# pending human gates: run_id -> {node_id: asyncio.Future[bool]}
_pending: dict[str, dict[str, asyncio.Future]] = {}


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/version")
def version():
    # RENDER_GIT_COMMIT is injected by Render; lets us confirm which build is live.
    return {
        "commit": os.environ.get("RENDER_GIT_COMMIT", "unknown")[:12],
        "build": "litellm+groq-routing",
    }


@app.get("/tools")
def tools_catalog(_=Depends(require_token)):
    # Single source of truth for tool auth + fields, so the frontend can render
    # connector modals without duplicating the schema.
    from tool_schema import TOOL_SCHEMA

    return TOOL_SCHEMA


@app.post("/schedule")
async def schedule(req: Request, _=Depends(require_token)):
    body = await req.json()
    import scheduler  # lazy (pulls crewai)

    payload = {
        "flow": body["flow"],
        "credentials": body.get("credentials", {}) or {},
        "llm": body.get("llm", {}) or {},
    }
    return scheduler.add(body["cron"], body.get("summary", ""), payload)


@app.get("/schedules")
def schedules(_=Depends(require_token)):
    import scheduler

    return scheduler.listing()


@app.delete("/schedule/{job_id}")
def unschedule(job_id: str, _=Depends(require_token)):
    import scheduler

    return {"removed": scheduler.remove(job_id)}


@app.post("/test-tool")
async def test_tool(req: Request, _=Depends(require_token)):
    body = await req.json()
    import tool_test  # light import (no crewai)

    return tool_test.test_tool(body.get("toolKey", ""), body.get("credentials", {}) or {})


@app.post("/approve")
async def approve(req: Request, _=Depends(require_token)):
    body = await req.json()
    run_id = body.get("run_id", "")
    node_id = body.get("node_id", "")
    approved = bool(body.get("approved", False))
    fut = _pending.get(run_id, {}).get(node_id)
    if fut and not fut.done():
        fut.set_result(approved)
        return {"ok": True}
    return JSONResponse({"ok": False, "error": "no pending gate"}, status_code=404)


@app.post("/run")
async def run(req: Request, _=Depends(require_token)):
    payload = await req.json()
    run_id = uuid.uuid4().hex[:12]
    loop = asyncio.get_running_loop()
    _pending[run_id] = {}

    async def wait_for_approval(node_id: str, _prompt: str) -> bool:
        fut: asyncio.Future = loop.create_future()
        _pending[run_id][node_id] = fut
        try:
            return await fut
        finally:
            _pending[run_id].pop(node_id, None)

    # Imported lazily so the server (and /health) boot without the heavy crewai
    # import — only a real run pays that cost.
    import crew_runner

    async def stream():
        yield json.dumps({"type": "run", "run_id": run_id}) + "\n"
        try:
            async for ev in crew_runner.run_flow(payload, wait_for_approval):
                yield json.dumps(ev) + "\n"
        except Exception as e:  # noqa: BLE001
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"
        finally:
            _pending.pop(run_id, None)

    return StreamingResponse(stream(), media_type="application/x-ndjson")


if __name__ == "__main__":
    import uvicorn

    # Hosts (Render/Railway/Fly) inject PORT; bind all interfaces in a container.
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
