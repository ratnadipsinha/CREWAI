"""Gmail access via OAuth refresh token (works with a personal Gmail account).

You authorize once (e.g. in Google's OAuth Playground) with the gmail.readonly
scope to obtain a refresh token; the backend exchanges it for short-lived access
tokens and reads the inbox. No service account / Workspace needed.

Credentials (from the on-the-fly modal): GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET,
GMAIL_REFRESH_TOKEN.
"""
from __future__ import annotations

import requests

from creds import cred

_TOKEN = "https://oauth2.googleapis.com/token"
_API = "https://gmail.googleapis.com/gmail/v1/users/me"


def get_access_token(creds: dict) -> str:
    r = requests.post(
        _TOKEN,
        data={
            "grant_type": "refresh_token",
            "refresh_token": cred(creds, "GMAIL_REFRESH_TOKEN", required=True),
            "client_id": cred(creds, "GMAIL_CLIENT_ID", required=True),
            "client_secret": cred(creds, "GMAIL_CLIENT_SECRET", required=True),
        },
        timeout=30,
    )
    if not r.ok:
        raise RuntimeError(f"Gmail token request failed ({r.status_code}): {r.text}")
    return r.json()["access_token"]


def _fetch(creds: dict, top: int, query: str | None) -> list[dict]:
    token = get_access_token(creds)
    headers = {"Authorization": f"Bearer {token}"}
    params: dict = {"maxResults": max(1, min(top, 25)), "labelIds": "INBOX"}
    if query:
        params["q"] = query
    lr = requests.get(f"{_API}/messages", headers=headers, params=params, timeout=30)
    if not lr.ok:
        raise RuntimeError(f"Gmail list failed ({lr.status_code}): {lr.text}")
    ids = [m["id"] for m in lr.json().get("messages", [])]

    out: list[dict] = []
    for mid in ids:
        mr = requests.get(
            f"{_API}/messages/{mid}",
            headers=headers,
            params={"format": "metadata", "metadataHeaders": ["Subject", "From", "Date"]},
            timeout=30,
        )
        if not mr.ok:
            continue
        data = mr.json()
        hdrs = {h["name"]: h["value"] for h in data.get("payload", {}).get("headers", [])}
        out.append(
            {
                "subject": hdrs.get("Subject", ""),
                "from": hdrs.get("From", ""),
                "received": hdrs.get("Date", ""),
                "preview": (data.get("snippet", "") or "").strip(),
            }
        )
    return out


def read_inbox(creds: dict, top: int = 5, query: str | None = None) -> list[dict]:
    """Read inbox messages. A search `query` is best-effort: if it matches nothing
    fall back to the most recent messages, so real mail is never hidden."""
    if query:
        try:
            hits = _fetch(creds, top, query)
            if hits:
                return hits
        except Exception:
            pass
    return _fetch(creds, top, None)
