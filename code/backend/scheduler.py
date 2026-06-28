"""Actually schedule crew runs on the backend.

Registers each saved schedule as a recurring job (APScheduler, cron trigger) that
runs the flow headless. Scheduled runs auto-approve human gates (there's no
interactive user) and keep the last result so the UI can show what happened.

Note: on a free/idle host the process may sleep and in-memory jobs are lost on
restart — for production reliability run an always-on instance or trigger /run
from an external cron.
"""
from __future__ import annotations

import asyncio
import datetime
import uuid

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

import crew_runner

_sched = BackgroundScheduler(daemon=True)
_sched.start()
_jobs: dict[str, dict] = {}


async def _run_headless(payload: dict) -> str:
    async def _auto_approve(_node_id: str, _prompt: str) -> bool:
        return True  # no interactive user for a scheduled run

    summary = ""
    async for ev in crew_runner.run_flow(payload, _auto_approve):
        if ev.get("type") == "done":
            summary = ev.get("summary", "")
        elif ev.get("type") == "error":
            summary = "ERROR: " + ev.get("message", "")
    return summary


def _job_fn(job_id: str, payload: dict) -> None:
    try:
        result = asyncio.run(_run_headless(payload))
    except Exception as e:  # noqa: BLE001
        result = f"ERROR: {e}"
    rec = _jobs.get(job_id)
    if rec:
        rec["last_run"] = datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z"
        rec["last_result"] = (result or "")[:500]


def _next_run(job_id: str) -> str | None:
    job = _sched.get_job(job_id)
    return str(job.next_run_time) if job and job.next_run_time else None


def add(cron: str, summary: str, payload: dict) -> dict:
    job_id = uuid.uuid4().hex[:10]
    _sched.add_job(
        _job_fn,
        CronTrigger.from_crontab(cron),
        args=[job_id, payload],
        id=job_id,
        replace_existing=True,
    )
    _jobs[job_id] = {
        "id": job_id,
        "cron": cron,
        "summary": summary,
        "last_run": None,
        "last_result": None,
        "next_run": _next_run(job_id),
    }
    return _jobs[job_id]


def listing() -> list[dict]:
    for jid, rec in _jobs.items():
        rec["next_run"] = _next_run(jid)
    return list(_jobs.values())


def remove(job_id: str) -> bool:
    try:
        _sched.remove_job(job_id)
    except Exception:  # noqa: BLE001
        pass
    return _jobs.pop(job_id, None) is not None
