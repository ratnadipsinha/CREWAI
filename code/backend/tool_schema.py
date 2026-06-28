"""Tool auth schemas — the single, dependency-light source of truth for each
tool's auth type and credential field names (mirrors the frontend's tools.ts).

Kept free of crewai imports so both the heavy tool registry and the lightweight
credential-test endpoint can share it.
"""
from __future__ import annotations

import os

TOOL_SCHEMA: dict[str, dict] = {
    "gmail": {
        "auth": "oauth",
        "fields": ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"],
    },
    "outlook": {
        "auth": "oauth",
        "fields": [
            "OUTLOOK_CLIENT_ID",
            "OUTLOOK_TENANT_ID",
            "OUTLOOK_CLIENT_SECRET",
            "OUTLOOK_USER",
        ],
    },
    "jira": {"auth": "basic", "fields": ["JIRA_URL", "JIRA_USER", "JIRA_TOKEN"]},
    "hubspot": {"auth": "apikey", "fields": ["HUBSPOT_API_KEY"]},
    "netsuite": {
        "auth": "apikey",
        "fields": ["NETSUITE_ACCOUNT_ID", "NETSUITE_CONSUMER_KEY", "NETSUITE_TOKEN"],
    },
    "ocr": {"auth": "none", "fields": []},
}


def missing_fields(creds: dict, fields: list[str]) -> list[str]:
    return [f for f in fields if not (creds.get(f) or os.environ.get(f, "")).strip()]
