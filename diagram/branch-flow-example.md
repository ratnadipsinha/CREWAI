# Branch Flow Example — Invoice-to-Approval (AP automation)

How a canvas with a **Branch** block maps to a generated CrewAI `Flow`
(`@start` → `@router` → `@listen`). Connector colors drive routing:
green = clean path, pink = needs a person.

## Canvas graph

```mermaid
flowchart TD
    T["⚡ Trigger<br/>gmail.new_email"] --> R["🤖 Inbox Reader<br/>(gmail)"]
    R --> X["🤖 Extractor<br/>(ocr)"]
    X --> V["🤖 Validator"]
    V --> BR{"🔀 Router<br/>result.is_clean and<br/>not result.is_duplicate"}

    BR -- clean --> REC["🤖 Recorder<br/>(hubspot)"]
    REC -- clean --> PREP["🤖 Payment Preparer"]
    PREP -- clean --> H["🙋 Authorization gate"]
    BR -- needs a person --> H

    linkStyle 4 stroke:#22c55e,stroke-width:2px
    linkStyle 5 stroke:#22c55e,stroke-width:2px
    linkStyle 6 stroke:#22c55e,stroke-width:2px
    linkStyle 7 stroke:#ec4899,stroke-width:2px
```

## Generated execution (CrewAI Flow)

```mermaid
flowchart TD
    K["GeneratedFlow.kickoff()"] --> PRE["@start pre()<br/>Reader → Extractor → Validator<br/>→ self.state['result']"]
    PRE --> ROUTE{"@router route()<br/>bool(result.is_clean and<br/>not result.is_duplicate)"}
    ROUTE -- "'clean'" --> CLEAN["@listen('clean') clean_path()<br/>Recorder + Preparer<br/>+ approval gate"]
    ROUTE -- "'flagged'" --> FLAG["@listen('flagged') flagged_path()<br/>human review / approval gate"]
```

## Mapping

| Canvas | Generated Flow |
|--------|----------------|
| Nodes upstream of the Router | `@start pre()` sub-crew |
| Router `condition` | `@router route()` → returns `"clean"` / `"flagged"` |
| green (clean) edges from Router | `@listen("clean") clean_path()` |
| pink (person) edges from Router | `@listen("flagged") flagged_path()` |
| Human gate on a path | `input("Approve? [y/N]")` block inside that path |

Generated `crew.py` (excerpt):

```python
class GeneratedFlow(Flow):
    @start()
    def pre(self):
        result = _crew([reader, extractor, validator], [t_read, t_extract, t_validate]).kickoff()
        self.state['result'] = result
        return result

    @router(pre)
    def route(self):
        result = self.state.get('result')
        try:
            decision = bool(result.is_clean and not result.is_duplicate)
        except Exception:
            decision = True
        return "clean" if decision else "flagged"

    @listen("clean")
    def clean_path(self):
        result = _crew([recorder, preparer], [t_record, t_prepare]).kickoff()
        print("Require a person to approve before paying.")
        if input("Approve? [y/N] ").strip().lower() != "y":
            return "Halted: not approved by human."
        return result

    @listen("flagged")
    def flagged_path(self):
        print("Require a person to approve before paying.")
        if input("Approve? [y/N] ").strip().lower() != "y":
            return "Halted: not approved by human."
        return None
```
