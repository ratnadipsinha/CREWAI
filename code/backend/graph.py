"""Microsoft Graph access for Outlook, using app-only client credentials.

The Azure AD app registration must have the APPLICATION permission Mail.Read
granted with admin consent. App-only tokens have no signed-in user, so every
call targets a specific mailbox named by OUTLOOK_USER.

Credentials are resolved with `cred(creds, NAME)` — values posted from the
browser take precedence, falling back to the backend's own environment.
"""
import time
import requests

from creds import cred

_GRAPH = "https://graph.microsoft.com/v1.0"
_token_cache: dict[str, tuple[str, float]] = {}


def get_token(creds: dict) -> str:
    """Client-credentials token for Graph, cached per-tenant until ~1 min before expiry."""
    tenant = cred(creds, "OUTLOOK_TENANT_ID", required=True)
    now = time.time()
    cached = _token_cache.get(tenant)
    if cached and now < cached[1]:
        return cached[0]

    url = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
    resp = requests.post(
        url,
        data={
            "grant_type": "client_credentials",
            "client_id": cred(creds, "OUTLOOK_CLIENT_ID", required=True),
            "client_secret": cred(creds, "OUTLOOK_CLIENT_SECRET", required=True),
            "scope": "https://graph.microsoft.com/.default",
        },
        timeout=30,
    )
    if not resp.ok:
        raise RuntimeError(f"Token request failed ({resp.status_code}): {resp.text}")
    data = resp.json()
    token = data["access_token"]
    _token_cache[tenant] = (token, now + float(data.get("expires_in", 3600)) - 60)
    return token


def read_inbox(creds: dict, top: int = 5, query: str | None = None) -> list[dict]:
    """Read the latest messages from OUTLOOK_USER's inbox."""
    user = cred(creds, "OUTLOOK_USER", required=True)
    params = {
        "$top": str(max(1, min(top, 25))),
        "$select": "subject,from,receivedDateTime,bodyPreview,hasAttachments",
        "$orderby": "receivedDateTime desc",
    }
    headers = {"Authorization": f"Bearer {get_token(creds)}"}
    # $search and $orderby can't be combined; drop ordering when searching.
    if query:
        params.pop("$orderby", None)
        params["$search"] = f'"{query}"'
        headers["ConsistencyLevel"] = "eventual"
    resp = requests.get(
        f"{_GRAPH}/users/{user}/mailFolders/Inbox/messages",
        headers=headers,
        params=params,
        timeout=30,
    )
    if not resp.ok:
        raise RuntimeError(f"Graph read failed ({resp.status_code}): {resp.text}")
    out = []
    for m in resp.json().get("value", []):
        out.append(
            {
                "subject": m.get("subject", ""),
                "from": (m.get("from", {}).get("emailAddress", {}) or {}).get("address", ""),
                "received": m.get("receivedDateTime", ""),
                "preview": (m.get("bodyPreview", "") or "").strip(),
                "hasAttachments": m.get("hasAttachments", False),
            }
        )
    return out
