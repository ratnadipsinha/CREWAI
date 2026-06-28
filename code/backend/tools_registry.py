"""Schema-driven tool registry — the backend mirror of the frontend's tools.ts.

Each tool declares its auth type and credential fields. At run time the backend:
  1. reads the tool key off the canvas (Tool blocks wired to an agent),
  2. looks up its schema here,
  3. validates the posted credentials against that tool's `auth`/`fields`,
  4. builds a REAL CrewAI tool that performs the action with those credentials.

Tools whose auth can't be satisfied client-side (e.g. full OAuth user consent)
return a clear, structured message instead of crashing the run, so the agent can
still reason and the human sees exactly what's missing.
"""
from __future__ import annotations

import json
import requests
from crewai.tools import tool

from creds import cred
from tool_schema import TOOL_SCHEMA, missing_fields
import graph


def tool_status(key: str, creds: dict) -> dict:
    """Report whether a tool is ready to run with the supplied credentials."""
    schema = TOOL_SCHEMA.get(key)
    if not schema:
        return {"key": key, "ready": False, "reason": "unknown tool"}
    miss = missing_fields(creds, schema["fields"])
    return {
        "key": key,
        "auth": schema["auth"],
        "ready": not miss,
        "missing": miss,
    }


# ---- per-tool builders: (creds) -> list[crewai tool] ------------------------


def _build_mcp(creds: dict):
    """Generic connector: expose every tool from a user-provided MCP server.
    Works for ANY service that ships an MCP server — no per-service code."""
    url = cred(creds, "MCP_SERVER_URL", required=True)
    token = cred(creds, "MCP_AUTH_TOKEN")
    try:
        from crewai_tools import MCPServerAdapter

        params: dict = {"url": url}
        if token:
            params["headers"] = {"Authorization": f"Bearer {token}"}
        return list(MCPServerAdapter(params).tools)
    except Exception as e:  # noqa: BLE001
        return _build_unsupported("mcp", f"could not connect to MCP server: {e}")


def _build_gmail(creds: dict):
    import gmail as gmail_api

    @tool("read_gmail_inbox")
    def read_gmail_inbox(query: str = "", count: int = 5) -> str:
        """Read recent emails (subject, sender, snippet) from the connected Gmail
        inbox. Optional `query` is a Gmail search (e.g. 'from:billing'); `count`
        caps the number of messages (max 25)."""
        try:
            msgs = gmail_api.read_inbox(creds, top=count, query=query or None)
        except Exception as e:  # noqa: BLE001
            return f"[gmail error] {e}"
        if not msgs:
            return "No messages found."
        return json.dumps(msgs, indent=2)

    return [read_gmail_inbox]


def _build_outlook(creds: dict):
    @tool("read_outlook_inbox")
    def read_outlook_inbox(query: str = "", count: int = 5) -> str:
        """Read recent emails (subject, sender, preview) from the configured
        Outlook mailbox. Optional `query` filters by a search term; `count` caps
        the number of messages (max 25)."""
        try:
            msgs = graph.read_inbox(creds, top=count, query=query or None)
        except Exception as e:  # noqa: BLE001 — surface a usable message to the agent
            return f"[outlook error] {e}"
        if not msgs:
            return "No messages found."
        return json.dumps(msgs, indent=2)

    return [read_outlook_inbox]


def _build_jira(creds: dict):
    base = cred(creds, "JIRA_URL").rstrip("/")
    auth = (cred(creds, "JIRA_USER"), cred(creds, "JIRA_TOKEN"))

    @tool("create_jira_ticket")
    def create_jira_ticket(summary: str, description: str = "", project: str = "OPS") -> str:
        """Create a Jira issue (type Task) with the given summary/description."""
        try:
            r = requests.post(
                f"{base}/rest/api/2/issue",
                auth=auth,
                json={
                    "fields": {
                        "project": {"key": project},
                        "summary": summary,
                        "description": description,
                        "issuetype": {"name": "Task"},
                    }
                },
                timeout=30,
            )
        except Exception as e:  # noqa: BLE001
            return f"[jira error] {e}"
        if not r.ok:
            return f"[jira {r.status_code}] {r.text}"
        return f"Created {r.json().get('key', '?')}"

    return [create_jira_ticket]


def _build_hubspot(creds: dict):
    key = cred(creds, "HUBSPOT_API_KEY")

    @tool("write_hubspot_record")
    def write_hubspot_record(properties_json: str) -> str:
        """Create a HubSpot contact. Pass a JSON object of properties, e.g.
        {"email":"a@b.com","firstname":"Ada"}."""
        try:
            props = json.loads(properties_json)
        except Exception:
            return "[hubspot error] properties_json must be a JSON object"
        try:
            r = requests.post(
                "https://api.hubapi.com/crm/v3/objects/contacts",
                headers={"Authorization": f"Bearer {key}"},
                json={"properties": props},
                timeout=30,
            )
        except Exception as e:  # noqa: BLE001
            return f"[hubspot error] {e}"
        if not r.ok:
            return f"[hubspot {r.status_code}] {r.text}"
        return f"HubSpot record {r.json().get('id', 'created')}"

    return [write_hubspot_record]


def _build_unsupported(key: str, why: str):
    """A tool that runs but explains it can't act, so the agent/human knows why."""

    @tool(f"{key}_action")
    def _action(input: str = "") -> str:
        """Placeholder tool — see the returned message for what's required."""
        return f"[{key} unavailable] {why}"

    _action.name = f"{key}_action"
    return [_action]


def build_tools(key: str, creds: dict) -> list:
    """Build the real CrewAI tool(s) for a tool key, validating auth/fields first."""
    schema = TOOL_SCHEMA.get(key)
    if not schema:
        return _build_unsupported(key, f"unknown tool '{key}'")

    miss = missing_fields(creds, schema["fields"])
    if miss:
        return _build_unsupported(
            key, f"missing {schema['auth']} credentials: {', '.join(miss)}"
        )

    if key == "outlook":
        return _build_outlook(creds)
    if key == "jira":
        return _build_jira(creds)
    if key == "hubspot":
        return _build_hubspot(creds)
    if key == "ocr":
        try:
            from crewai_tools import FileReadTool

            return [FileReadTool()]
        except Exception:  # noqa: BLE001
            return _build_unsupported("ocr", "crewai_tools FileReadTool not installed")
    if key == "gmail":
        return _build_gmail(creds)
    if key == "mcp":
        return _build_mcp(creds)
    if key == "netsuite":
        return _build_unsupported(
            "netsuite", "NetSuite needs Token-Based Auth (TBA) signing; not wired in this demo."
        )
    return _build_unsupported(key, "no builder for this tool")
