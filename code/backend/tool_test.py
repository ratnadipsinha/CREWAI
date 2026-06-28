"""Lightweight credential / login tests for tools — used by the modal's "Test"
button. Intentionally avoids importing crewai so the check is fast: it just does
the tool's auth handshake (and a tiny read) and reports success or the error.
"""
from __future__ import annotations

import requests

from creds import cred
import graph


def test_tool(key: str, creds: dict) -> dict:
    """Return {ok, message} after attempting the tool's auth/login."""
    try:
        if key == "outlook":
            graph.get_token(creds)  # validates client id / tenant / secret
            msgs = graph.read_inbox(creds, top=3)
            if msgs:
                subs = "; ".join((m["subject"] or "(no subject)") for m in msgs)
                return {"ok": True, "message": f"Authenticated ✓ — {len(msgs)} recent: {subs}"}
            return {"ok": True, "message": "Authenticated ✓ — but the inbox returned 0 messages "
                                           "(check the mailbox address / Mail.Read consent)."}

        if key == "jira":
            base = cred(creds, "JIRA_URL", required=True).rstrip("/")
            r = requests.get(
                f"{base}/rest/api/2/myself",
                auth=(cred(creds, "JIRA_USER", required=True), cred(creds, "JIRA_TOKEN", required=True)),
                timeout=20,
            )
            if r.ok:
                return {"ok": True, "message": f"Authenticated ✓ as {r.json().get('displayName', '?')}"}
            return {"ok": False, "message": f"Jira {r.status_code}: {r.text[:200]}"}

        if key == "hubspot":
            r = requests.get(
                "https://api.hubapi.com/crm/v3/objects/contacts",
                params={"limit": 1},
                headers={"Authorization": f"Bearer {cred(creds, 'HUBSPOT_API_KEY', required=True)}"},
                timeout=20,
            )
            if r.ok:
                return {"ok": True, "message": "Authenticated ✓ — HubSpot reachable"}
            return {"ok": False, "message": f"HubSpot {r.status_code}: {r.text[:200]}"}

        return {"ok": False, "message": f"No login test available for '{key}'."}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "message": str(e)}
