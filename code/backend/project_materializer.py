"""Materialize the canvas FlowState into a real, runnable CrewAI project on disk
(the official layout), so the live run, the export, and `crewai run` all share one
source of truth. Returns the project dir; pair with env_writer for the `.env`.

This is the Python counterpart of the frontend's codegen.ts / exporter.ts.
"""
from __future__ import annotations

import os
import re

import flow_graph
import env_writer
from tools_registry import TOOL_SCHEMA


def _var(node: dict) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", (node.get("label") or node["type"]).lower()).strip("_")
    return f"{base or node['type']}_{node['id'].replace('.', '_')}"


def _py(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace('"""', '\\"\\"\\"')


def gen_agents(flow: dict) -> str:
    agents = [n for n in flow["nodes"] if n["type"] == "agent"]
    out = ['"""Agents composed on the canvas."""', "from crewai import Agent", ""]
    for a in agents:
        out += [
            f"{_var(a)} = Agent(",
            f'    role="""{_py(a.get("role",""))}""",',
            f'    goal="""{_py(a.get("goal",""))}""",',
            f'    backstory="""{_py(a.get("backstory",""))}""",',
            "    verbose=True,",
            ")",
            "",
        ]
    return "\n".join(out)


def gen_tasks(flow: dict) -> str:
    tasks = [n for n in flow["nodes"] if n["type"] == "task"]
    out = ['"""Tasks composed on the canvas."""', "from crewai import Task", "import agents", ""]
    for a in [n for n in flow["nodes"] if n["type"] == "agent"]:
        out.append(f"{_var(a)} = agents.{_var(a)}")
    out.append("")
    for t in tasks:
        agent = flow_graph.resolve_agent(flow, t)
        ref = _var(agent) if agent else "None  # connect an agent"
        out += [
            f"{_var(t)} = Task(",
            f'    description="""{_py(t.get("description",""))}""",',
            f'    expected_output="""{_py(t.get("expectedOutput",""))}""",',
            f"    agent={ref},",
            ")",
            "",
        ]
    return "\n".join(out)


def gen_crew(flow: dict) -> str:
    agents = [n for n in flow["nodes"] if n["type"] == "agent"]
    tasks = [n for n in flow["nodes"] if n["type"] == "task"]
    return "\n".join(
        [
            '"""Crew assembly."""',
            "from crewai import Crew, Process",
            "import agents, tasks",
            "",
            "crew = Crew(",
            f"    agents=[{', '.join('agents.' + _var(a) for a in agents)}],",
            f"    tasks=[{', '.join('tasks.' + _var(t) for t in tasks)}],",
            "    process=Process.sequential,",
            "    verbose=True,",
            ")",
            "",
            "def run(inputs=None):",
            "    return crew.kickoff(inputs=inputs or {})",
            "",
        ]
    )


def gen_main(flow: dict) -> str:
    trigger = next((n for n in flow["nodes"] if n["type"] == "trigger"), None)
    return "\n".join(
        [
            '"""Entry point. Run: python main.py  (or: crewai run)"""',
            "from dotenv import load_dotenv",
            "import crew",
            "",
            "load_dotenv()",
            "",
            'if __name__ == "__main__":',
            f"    # Trigger: {trigger.get('event','manual') if trigger else 'manual'}",
            "    print(crew.run())",
            "",
        ]
    )


def gen_requirements(flow: dict) -> str:
    base = ["crewai>=0.80", "crewai-tools>=0.14", "python-dotenv>=1.0", "requests>=2.31"]
    return "\n".join(base) + "\n"


def project_files(flow: dict) -> dict[str, str]:
    """The project's source files (everything except the secret .env)."""
    return {
        "agents.py": gen_agents(flow),
        "tasks.py": gen_tasks(flow),
        "crew.py": gen_crew(flow),
        "main.py": gen_main(flow),
        "requirements.txt": gen_requirements(flow),
    }


def materialize(dest_dir: str, flow: dict, creds: dict, settings: dict | None = None) -> str:
    """Write the full runnable project (source + .env) to dest_dir, return the path."""
    os.makedirs(dest_dir, exist_ok=True)
    for name, content in project_files(flow).items():
        with open(os.path.join(dest_dir, name), "w", encoding="utf-8") as f:
            f.write(content)
    env_writer.write_env(os.path.join(dest_dir, ".env"), flow, creds, settings)
    return dest_dir
