"""Credential resolution. A run posts the credentials the user typed in the
browser (keyed by env-var name, e.g. JIRA_TOKEN). They take precedence; the
backend's own environment is the fallback so secrets can also live server-side.
"""
import os


def cred(creds: dict, name: str, required: bool = False) -> str:
    val = (creds.get(name) or os.environ.get(name, "") or "").strip()
    if required and not val:
        raise RuntimeError(f"Missing credential: {name}")
    return val


def missing_fields(creds: dict, fields: list[str]) -> list[str]:
    return [f for f in fields if not (creds.get(f) or os.environ.get(f, "")).strip()]
