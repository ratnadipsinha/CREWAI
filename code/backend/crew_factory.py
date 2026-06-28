"""Crew construction — builds REAL CrewAI Agent / Task / Crew objects from the
canvas, attaching real tools resolved generically from each tool's auth schema.

Kept separate from orchestration (crew_runner) so the "what CrewAI objects do we
build" logic has one home and can be reused by both the streaming runner and a
future full-project `kickoff()`.
"""
from __future__ import annotations

from crewai import Agent, Task, Crew, Process

import flow_graph
from tools_registry import build_tools


def build_agent(llm, agent_node: dict, tools: list) -> Agent:
    return Agent(
        role=agent_node.get("role") or agent_node.get("label") or "Agent",
        goal=agent_node.get("goal") or "Complete the assigned step.",
        backstory=agent_node.get("backstory") or "You are a careful, reliable specialist.",
        tools=tools,
        llm=llm,
        verbose=False,
    )


def tools_for_agent(flow: dict, agent_id: str, creds: dict) -> list:
    """Real CrewAI tools for an agent, built from its wired Tool blocks."""
    tools: list = []
    for key in flow_graph.agent_tool_keys(flow, agent_id):
        tools.extend(build_tools(key, creds))
    return tools


def build_task(agent: Agent, task_node: dict, context: str = "") -> Task:
    description = task_node.get("description") or task_node.get("label") or "Perform the task."
    if context:
        description += f"\n\nContext from earlier steps:\n{context}"
    return Task(
        description=description,
        expected_output=task_node.get("expectedOutput") or "A clear, structured result.",
        agent=agent,
    )


def single_task_crew(llm, flow: dict, task_node: dict, creds: dict, context: str) -> Crew | None:
    """A real one-task Crew for the given task node, with its agent + tools.
    Returns None if no agent is connected."""
    agent_node = flow_graph.resolve_agent(flow, task_node)
    if not agent_node:
        return None
    agent = build_agent(llm, agent_node, tools_for_agent(flow, agent_node["id"], creds))
    task = build_task(agent, task_node, context)
    return Crew(agents=[agent], tasks=[task], process=Process.sequential, verbose=False)


def kickoff_text(crew: Crew, inputs: dict | None = None) -> str:
    """Run a crew and normalize the result to text."""
    result = crew.kickoff(inputs=inputs or {})
    return str(getattr(result, "raw", result)).strip()


def build_full_crew(llm, flow: dict, creds: dict, task_callback=None):
    """A single real multi-task Crew for the whole flow — true CrewAI process
    semantics and automatic task-context passing (vs. per-task crews).

    Returns (crew, desc_to_node) where desc_to_node maps each task's description
    to its canvas node id, so a task_callback can report which step finished.
    Only valid when the flow has no human gates (a single kickoff can't pause).
    """
    agents: dict[str, Agent] = {}
    tasks: list[Task] = []
    desc_to_node: dict[str, str] = {}

    for node in flow_graph.run_order(flow):
        if node["type"] != "task":
            continue
        agent_node = flow_graph.resolve_agent(flow, node)
        if not agent_node:
            continue
        aid = agent_node["id"]
        if aid not in agents:
            agents[aid] = build_agent(llm, agent_node, tools_for_agent(flow, aid, creds))
        task = build_task(agents[aid], node)  # no manual context; the Crew passes it
        tasks.append(task)
        desc_to_node[task.description] = node["id"]

    crew = Crew(
        agents=list(agents.values()),
        tasks=tasks,
        process=Process.sequential,
        verbose=False,
        task_callback=task_callback,
    )
    return crew, desc_to_node
