"""Flow-graph resolution — the single place that interprets the canvas FlowState.

Mirrors codegen.ts / runner.ts so the live run matches the generated project:
run order, which agent runs a task, and which tools attach to an agent.
"""
from __future__ import annotations


def exec_nodes(flow: dict) -> list[dict]:
    """Executable nodes (tool blocks are attachments, not steps)."""
    return [n for n in flow["nodes"] if n["type"] != "tool"]


def run_order(flow: dict) -> list[dict]:
    """Topological order of executable nodes, ties broken by canvas y (top-down)."""
    nodes = exec_nodes(flow)
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


def agents_by_id(flow: dict) -> dict[str, dict]:
    return {n["id"]: n for n in flow["nodes"] if n["type"] == "agent"}


def resolve_agent(flow: dict, task: dict) -> dict | None:
    """Agent that runs a task: prefer Agent->Task edge, then any link, then stored id."""
    agents = agents_by_id(flow)
    for e in flow["edges"]:
        if e["to"] == task["id"] and e["from"] in agents:
            return agents[e["from"]]
    for e in flow["edges"]:
        if e["from"] == task["id"] and e["to"] in agents:
            return agents[e["to"]]
    aid = task.get("agentId")
    return agents.get(aid) if aid else None


def agent_tool_keys(flow: dict, agent_id: str) -> list[str]:
    """Tool keys for the Tool blocks wired to an agent (de-duped, order-preserving)."""
    tool_by_node = {n["id"]: n.get("toolKey") for n in flow["nodes"] if n["type"] == "tool"}
    keys: list[str] = []
    for e in flow["edges"]:
        if e["from"] == agent_id and e["to"] in tool_by_node:
            keys.append(tool_by_node[e["to"]])
        if e["to"] == agent_id and e["from"] in tool_by_node:
            keys.append(tool_by_node[e["from"]])
    seen, out = set(), []
    for k in keys:
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return out


def used_tool_keys(flow: dict) -> list[str]:
    return sorted({n.get("toolKey") for n in flow["nodes"] if n["type"] == "tool" and n.get("toolKey")})
