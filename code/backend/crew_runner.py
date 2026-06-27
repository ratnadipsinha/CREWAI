"""Build and run a REAL CrewAI crew from a posted canvas FlowState.

This is the server-side, real-execution counterpart of the browser's executor.ts.
Each executable task is run as a genuine single-task CrewAI Crew so we get:
  - real agents (role/goal/backstory) driven by a real LLM,
  - real tools attached per agent, resolved generically from the tool registry
    (each tool's auth + fields decide how it's built),
  - per-step streaming, and a pause at human-approval gates.

Resolution rules (agent-for-task, tools-for-agent, run order) mirror codegen.ts
and runner.ts so the live run matches the generated project.
"""
from __future__ import annotations

import asyncio
import os
from typing import Awaitable, Callable

from crewai import Agent, Task, Crew, Process, LLM

from tools_registry import build_tools, tool_status


# ---- flow graph helpers (mirror runner.ts / codegen.ts) ---------------------


def _exec_nodes(flow: dict) -> list[dict]:
    return [n for n in flow["nodes"] if n["type"] != "tool"]


def run_order(flow: dict) -> list[dict]:
    """Topological order of executable nodes, ties broken by canvas y (top-down)."""
    nodes = _exec_nodes(flow)
    ids = {n["id"] for n in nodes}
    edges = [e for e in flow["edges"] if e["from"] in ids and e["to"] in ids]

    indeg = {n["id"]: 0 for n in nodes}
    adj: dict[str, list[str]] = {n["id"]: [] for n in nodes}
    for e in edges:
        adj[e["from"]].append(e["to"])
        indeg[e["to"]] = indeg.get(e["to"], 0) + 1

    by_id = {n["id"]: n for n in nodes}
    ready = sorted([n for n in nodes if indeg[n["id"]] == 0], key=lambda n: n.get("y", 0))
    order, seen = [], set()
    while ready:
        n = ready.pop(0)
        if n["id"] in seen:
            continue
        seen.add(n["id"])
        order.append(n)
        for to in adj.get(n["id"], []):
            indeg[to] -= 1
            if indeg[to] == 0 and to not in seen:
                ready.append(by_id[to])
        ready.sort(key=lambda n: n.get("y", 0))
    for n in nodes:  # append anything left out by a cycle
        if n["id"] not in seen:
            order.append(n)
    return order


def _agents_by_id(flow: dict) -> dict[str, dict]:
    return {n["id"]: n for n in flow["nodes"] if n["type"] == "agent"}


def resolve_agent(flow: dict, task: dict) -> dict | None:
    agents = _agents_by_id(flow)
    for e in flow["edges"]:
        if e["to"] == task["id"] and e["from"] in agents:
            return agents[e["from"]]
    for e in flow["edges"]:
        if e["from"] == task["id"] and e["to"] in agents:
            return agents[e["to"]]
    aid = task.get("agentId")
    return agents.get(aid) if aid else None


def agent_tool_keys(flow: dict, agent_id: str) -> list[str]:
    tool_by_node = {n["id"]: n.get("toolKey") for n in flow["nodes"] if n["type"] == "tool"}
    keys: list[str] = []
    for e in flow["edges"]:
        if e["from"] == agent_id and e["to"] in tool_by_node:
            keys.append(tool_by_node[e["to"]])
        if e["to"] == agent_id and e["from"] in tool_by_node:
            keys.append(tool_by_node[e["from"]])
    # de-dupe, keep order, drop empties
    seen, out = set(), []
    for k in keys:
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return out


# ---- LLM ---------------------------------------------------------------------


def make_llm(settings: dict) -> LLM:
    model = settings.get("model") or os.environ.get("LLM_MODEL") or "groq/llama-3.3-70b-versatile"
    base_url = settings.get("baseUrl") or os.environ.get("LLM_BASE_URL") or ""
    api_key = settings.get("apiKey") or os.environ.get("LLM_API_KEY") or ""
    kwargs: dict = {"model": model}
    if base_url:
        kwargs["base_url"] = base_url
    if api_key:
        kwargs["api_key"] = api_key
    return LLM(**kwargs)


# ---- the run -----------------------------------------------------------------

Event = dict
ApprovalFn = Callable[[str, str], Awaitable[bool]]


async def run_flow(
    payload: dict,
    wait_for_approval: ApprovalFn,
):
    """Async generator yielding step events. `wait_for_approval(node_id, prompt)`
    resolves True/False when the user approves/rejects a human gate."""
    flow: dict = payload["flow"]
    creds: dict = payload.get("credentials", {}) or {}
    settings: dict = payload.get("llm", {}) or {}

    order = run_order(flow)
    if not order:
        yield {"type": "done", "summary": "Nothing to run — canvas is empty."}
        return

    try:
        llm = make_llm(settings)
    except Exception as e:  # noqa: BLE001
        yield {"type": "error", "message": f"LLM init failed: {e}"}
        return

    # report tool readiness up front so the UI can show what's live vs. stubbed
    used_keys = sorted(
        {n.get("toolKey") for n in flow["nodes"] if n["type"] == "tool" and n.get("toolKey")}
    )
    if used_keys:
        yield {"type": "tools", "tools": [tool_status(k, creds) for k in used_keys]}

    context_parts: list[str] = []
    last_output = ""

    for node in order:
        nid, ntype = node["id"], node["type"]

        if ntype == "human":
            prompt = node.get("prompt", "Approve to continue?")
            yield {"type": "step", "id": nid, "status": "await", "detail": prompt}
            approved = await wait_for_approval(nid, prompt)
            if not approved:
                yield {"type": "step", "id": nid, "status": "halted", "output": "rejected by user"}
                yield {"type": "done", "summary": "Run halted — not approved. No downstream actions taken."}
                return
            yield {"type": "step", "id": nid, "status": "done", "output": "approved by user"}
            context_parts.append("[human approved]")
            continue

        if ntype in ("trigger", "branch", "end"):
            detail = node.get("event") or node.get("condition") or ""
            yield {"type": "step", "id": nid, "status": "running", "detail": detail}
            out = {
                "trigger": f"trigger ready: {node.get('event', 'manual')}",
                "branch": f"routing on: {node.get('condition', '(none)')} → taking clean path",
                "end": "workflow end",
            }[ntype]
            yield {"type": "step", "id": nid, "status": "done", "output": out}
            context_parts.append(f"{node.get('label', ntype)}: {out}")
            continue

        if ntype == "agent":
            # agents are materialized when their task runs; just acknowledge
            yield {"type": "step", "id": nid, "status": "done", "output": f"{node.get('role') or node.get('label')} ready"}
            continue

        if ntype == "task":
            yield {"type": "step", "id": nid, "status": "running", "detail": node.get("description", "")}
            agent_node = resolve_agent(flow, node)
            if not agent_node:
                yield {"type": "step", "id": nid, "status": "done", "output": "(no agent connected — skipped)"}
                continue

            # build real tools for this agent, generically, from the registry
            tools = []
            for k in agent_tool_keys(flow, agent_node["id"]):
                tools.extend(build_tools(k, creds))

            try:
                out = await asyncio.to_thread(
                    _run_single_task, llm, agent_node, node, tools, "\n".join(context_parts)
                )
            except Exception as e:  # noqa: BLE001
                out = f"error: {e}"
            last_output = out
            yield {"type": "step", "id": nid, "status": "done", "output": out}
            context_parts.append(f"{node.get('label', 'task')}: {out}")
            continue

    yield {"type": "done", "summary": last_output or "Run complete."}


def _run_single_task(llm, agent_node: dict, task_node: dict, tools: list, context: str) -> str:
    """Blocking: run one task as a real CrewAI single-task crew."""
    agent = Agent(
        role=agent_node.get("role") or agent_node.get("label") or "Agent",
        goal=agent_node.get("goal") or "Complete the assigned step.",
        backstory=agent_node.get("backstory") or "You are a careful, reliable specialist.",
        tools=tools,
        llm=llm,
        verbose=False,
    )
    description = task_node.get("description") or task_node.get("label") or "Perform the task."
    if context:
        description += f"\n\nContext from earlier steps:\n{context}"
    task = Task(
        description=description,
        expected_output=task_node.get("expectedOutput") or "A clear, structured result.",
        agent=agent,
    )
    crew = Crew(agents=[agent], tasks=[task], process=Process.sequential, verbose=False)
    result = crew.kickoff()
    return str(getattr(result, "raw", result)).strip()
