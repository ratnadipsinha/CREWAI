# Running a CrewAI Crew

How to run a crew of agents with CrewAI — prerequisites, setup, and commands.
Sourced from the official docs: <https://docs.crewai.com/installation> and
<https://docs.crewai.com/quickstart>.

## Prerequisites

- **Python** `>=3.10` and `<3.14` — check with `python3 --version`
- **uv** — CrewAI's dependency / package manager
  - macOS/Linux: `curl -LsSf https://astral.sh/uv/install.sh | sh`
  - Windows: `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`
- **CrewAI CLI**: `uv tool install crewai` (verify with `uv tool list`)
- **An LLM API key** (e.g. `OPENAI_API_KEY`, or another provider's) — required; agents can't reason without it
- **Optional tool keys** depending on the tools used, e.g. `SERPER_API_KEY` for web search
- All keys go in a **`.env`** file at the project root — never hardcoded

## Create a project

- **Crew project:** `crewai create crew <project_name>`
  - Add `--classic` for the legacy Python/YAML layout (`agents.yaml`, `tasks.yaml`)
- **Flow project (state + branching):** `crewai create flow <project_name>` then `cd <project_name>`

## Project structure (classic)

- `src/<project>/main.py` — entry point
- `src/<project>/crew.py` — crew assembly
- `config/agents.yaml`, `config/tasks.yaml` — agent / task definitions
- `.env` — API keys
- `pyproject.toml` — dependencies

## Install & run (CLI)

- **Install deps:** `crewai install`
- **Run the crew:** `crewai run`
- Legacy alternative entry point: `python src/<project>/main.py`

## Run programmatically (in your own code)

```python
from crewai import Crew, Process

crew = Crew(agents=[...], tasks=[...], process=Process.sequential)
result = crew.kickoff(inputs={...})
```

- Variants: `kickoff_async(...)`, `kickoff_for_each(inputs=[...])` for batch runs

## How this maps to this project

- The **exported** project follows the CLI path: `pip install -r requirements.txt` → `python main.py`.
- The **live-run backend** uses the programmatic `crew.kickoff()` path (see `code/backend/crew_runner.py`).
- Both still require an LLM key. If the app shows **"Dry run"**, no backend URL is set, so it never reaches the `kickoff()` call.

## Sources

- <https://docs.crewai.com/installation>
- <https://docs.crewai.com/quickstart>
