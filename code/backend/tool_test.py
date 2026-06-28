"""Schema-driven credential / login test for ANY tool — used by the modal's
"Test" button. Avoids importing crewai so the check is fast.

For every tool it first validates that the required fields are present, then:
  - runs a real auth handshake where one is possible (Outlook, Jira, HubSpot,
    Gmail if an access token is supplied),
  - and for tools whose auth can't be exercised here (Gmail w/o token, NetSuite
    TBA, custom/unknown), reports that the fields are present and what's needed
    for a full live check — so the button always gives a useful answer.
"""
from __future__ import annotations

import requests

from creds import cred
from tool_schema import TOOL_SCHEMA, missing_fields
import graph
import gmail as gmail_api


def _outlook(creds: dict) -> dict:
    graph.get_token(creds)  # validates client id / tenant / secret
    msgs = graph.read_inbox(creds, top=3)
    if msgs:
        subs = "; ".join((m["subject"] or "(no subject)") for m in msgs)
        return {"ok": True, "message": f"Authenticated ✓ — {len(msgs)} recent: {subs}"}
    return {"ok": True, "message": "Authenticated ✓ — but the inbox returned 0 messages "
                                   "(check the mailbox address / Mail.Read admin consent)."}


def _jira(creds: dict) -> dict:
    base = cred(creds, "JIRA_URL", required=True).rstrip("/")
    r = requests.get(
        f"{base}/rest/api/2/myself",
        auth=(cred(creds, "JIRA_USER", required=True), cred(creds, "JIRA_TOKEN", required=True)),
        timeout=20,
    )
    if r.ok:
        return {"ok": True, "message": f"Authenticated ✓ as {r.json().get('displayName', '?')}"}
    return {"ok": False, "message": f"Jira {r.status_code}: {r.text[:200]}"}


def _hubspot(creds: dict) -> dict:
    r = requests.get(
        "https://api.hubapi.com/crm/v3/objects/contacts",
        params={"limit": 1},
        headers={"Authorization": f"Bearer {cred(creds, 'HUBSPOT_API_KEY', required=True)}"},
        timeout=20,
    )
    if r.ok:
        return {"ok": True, "message": "Authenticated ✓ — HubSpot reachable"}
    return {"ok": False, "message": f"HubSpot {r.status_code}: {r.text[:200]}"}


def _gmail(creds: dict) -> dict:
    # Refresh-token flow: exchange for an access token and read a few messages.
    gmail_api.get_access_token(creds)  # validates client id/secret/refresh token
    msgs = gmail_api.read_inbox(creds, top=3)
    if msgs:
        subs = "; ".join((m["subject"] or "(no subject)") for m in msgs)
        return {"ok": True, "message": f"Authenticated ✓ — {len(msgs)} recent: {subs}"}
    return {"ok": True, "message": "Authenticated ✓ — inbox returned 0 messages."}


def _netsuite(_creds: dict) -> dict:
    return {"ok": True, "message": "Fields present ✓ — NetSuite Token-Based Auth signing "
                                   "isn't exercised here."}


_LIVE = {
    "outlook": _outlook,
    "jira": _jira,
    "hubspot": _hubspot,
    "gmail": _gmail,
    "netsuite": _netsuite,
}


def test_tool(key: str, creds: dict) -> dict:
    """Return {ok, message} after validating + (where possible) authenticating."""
    schema = TOOL_SCHEMA.get(key)

    # 1. required-field validation (works for every known tool)
    if schema:
        miss = missing_fields(creds, schema["fields"])
        if miss:
            return {"ok": False, "message": f"Missing required field(s): {', '.join(miss)}"}
        if schema["auth"] == "none":
            return {"ok": True, "message": "No credentials required ✓"}

    # 2. live handshake where we have one
    try:
        if key in _LIVE:
            return _LIVE[key](creds)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "message": str(e)}

    # 3. unknown / custom tool — we can't reach an endpoint, but fields look set
    return {"ok": True, "message": "Credentials present ✓ (no live endpoint test for this tool)."}
