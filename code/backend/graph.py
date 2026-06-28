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


def _fetch(creds: dict, user: str, top: int, query: str | None) -> list[dict]:
    params = {
        "$top": str(max(1, min(top, 25))),
        "$select": "subject,from,receivedDateTime,bodyPreview,hasAttachments",
    }
    headers = {"Authorization": f"Bearer {get_token(creds)}"}
    if query:
        # $search can't be combined with $orderby; results come ranked.
        params["$search"] = f'"{query}"'
        headers["ConsistencyLevel"] = "eventual"
    else:
        params["$orderby"] = "receivedDateTime desc"
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


def read_inbox(creds: dict, top: int = 5, query: str | None = None) -> list[dict]:
    """Read messages from OUTLOOK_USER's inbox. A search `query` is best-effort:
    if it matches nothing (agents often pass natural-language terms that Graph's
    $search can't match), fall back to the most recent messages so real mail is
    never silently hidden."""
    user = cred(creds, "OUTLOOK_USER", required=True)
    if query:
        try:
            hits = _fetch(creds, user, top, query)
            if hits:
                return hits
        except Exception:
            pass  # fall through to recent
    return _fetch(creds, user, top, None)
