"""Orchestration only — walks the flow in run order and streams step events,
delegating graph resolution to flow_graph, CrewAI object construction to
crew_factory, the LLM to llm_factory, and tool readiness to tools_registry.

This is the server-side, real-execution counterpart of the browser's executor.ts:
each task runs as a real CrewAI crew (real agents, real LLM, real tools), with a
pause at human-approval gates.
"""
from __future__ import annotations

import asyncio
from typing import Awaitable, Callable

import flow_graph
import crew_factory
from llm_factory import make_llm
from tools_registry import tool_status


ApprovalFn = Callable[[str, str], Awaitable[bool]]


async def run_flow(payload: dict, wait_for_approval: ApprovalFn):
    """Async generator of step events. `wait_for_approval(node_id, prompt)` resolves
    True/False when the user approves/rejects a human gate."""
    flow: dict = payload["flow"]
    creds: dict = payload.get("credentials", {}) or {}
    settings: dict = payload.get("llm", {}) or {}

    order = flow_graph.run_order(flow)
    if not order:
        yield {"type": "done", "summary": "Nothing to run — canvas is empty."}
        return

    try:
        llm = make_llm(settings)
    except Exception as e:  # noqa: BLE001
        yield {"type": "error", "message": f"LLM init failed: {e}"}
        return

    used = flow_graph.used_tool_keys(flow)
    if used:
        yield {"type": "tools", "tools": [tool_status(k, creds) for k in used]}

    has_human = any(n["type"] == "human" for n in order)

    # Fast path: no human gate -> one real multi-task kickoff with true CrewAI
    # process semantics, streaming each task as its callback fires.
    if not has_human:
        async for ev in _run_full(llm, flow, creds, order):
            yield ev
        return

    # Segmented path: human gates need the run to pause, so run task-by-task.
    context: list[str] = []
    last_output = ""

    for node in order:
        nid, ntype = node["id"], node["type"]

        if ntype == "human":
            prompt = node.get("prompt", "Approve to continue?")
            yield {"type": "step", "id": nid, "status": "await", "detail": prompt}
            if not await wait_for_approval(nid, prompt):
                yield {"type": "step", "id": nid, "status": "halted", "output": "rejected by user"}
                yield {"type": "done", "summary": "Run halted — not approved. No downstream actions taken."}
                return
            yield {"type": "step", "id": nid, "status": "done", "output": "approved by user"}
            context.append("[human approved]")
            continue

        if ntype in ("trigger", "branch", "end"):
            out = {
                "trigger": f"trigger ready: {node.get('event', 'manual')}",
                "branch": f"routing on: {node.get('condition', '(none)')} → taking clean path",
                "end": "workflow end",
            }[ntype]
            yield {"type": "step", "id": nid, "status": "done", "output": out}
            context.append(f"{node.get('label', ntype)}: {out}")
            continue

        if ntype == "agent":
            yield {"type": "step", "id": nid, "status": "done",
                   "output": f"{node.get('role') or node.get('label')} ready"}
            continue

        if ntype == "task":
            yield {"type": "step", "id": nid, "status": "running", "detail": node.get("description", "")}
            crew = crew_factory.single_task_crew(llm, flow, node, creds, "\n".join(context))
            if crew is None:
                yield {"type": "step", "id": nid, "status": "done", "output": "(no agent connected — skipped)"}
                continue
            try:
                out = await asyncio.to_thread(crew_factory.kickoff_text, crew)
            except Exception as e:  # noqa: BLE001
                out = f"error: {e}"
            last_output = out
            yield {"type": "step", "id": nid, "status": "done", "output": out}
            context.append(f"{node.get('label', 'task')}: {out}")
            continue

    yield {"type": "done", "summary": last_output or "Run complete."}


async def _run_full(llm, flow: dict, creds: dict, order: list[dict]):
    """Single multi-task kickoff; stream non-task nodes immediately and each task
    as its task_callback fires from the worker thread."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    crew, desc_to_node = crew_factory.build_full_crew(
        llm, flow, creds,
        task_callback=lambda out: loop.call_soon_threadsafe(queue.put_nowait, out),
    )

    # acknowledge the non-task nodes up front (trigger / agent / branch / end)
    for node in order:
        nid, ntype = node["id"], node["type"]
        if ntype == "trigger":
            yield {"type": "step", "id": nid, "status": "done", "output": f"trigger ready: {node.get('event','manual')}"}
        elif ntype == "agent":
            yield {"type": "step", "id": nid, "status": "done", "output": f"{node.get('role') or node.get('label')} ready"}
        elif ntype == "branch":
            yield {"type": "step", "id": nid, "status": "done", "output": f"routing on: {node.get('condition','(none)')} → clean path"}
        elif ntype == "task":
            yield {"type": "step", "id": nid, "status": "running", "detail": node.get("description", "")}

    run = asyncio.create_task(asyncio.to_thread(crew_factory.kickoff_text, crew))
    last = ""
    while not run.done() or not queue.empty():
        try:
            out = await asyncio.wait_for(queue.get(), timeout=0.2)
        except asyncio.TimeoutError:
            continue
        node_id = desc_to_node.get(getattr(out, "description", ""), None)
        text = str(getattr(out, "raw", out)).strip()
        last = text
        if node_id:
            yield {"type": "step", "id": node_id, "status": "done", "output": text}

    try:
        summary = await run
    except Exception as e:  # noqa: BLE001
        yield {"type": "error", "message": f"run failed: {e}"}
        return
    yield {"type": "done", "summary": summary or last or "Run complete."}
