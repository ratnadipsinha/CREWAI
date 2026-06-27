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
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse

import crew_runner

load_dotenv()

app = FastAPI(title="Visual Agent Builder — live run backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000")],
    allow_methods=["*"],
    allow_headers=["*"],
)

# pending human gates: run_id -> {node_id: asyncio.Future[bool]}
_pending: dict[str, dict[str, asyncio.Future]] = {}


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/approve")
async def approve(req: Request):
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
async def run(req: Request):
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

    uvicorn.run(app, host="127.0.0.1", port=8000)
