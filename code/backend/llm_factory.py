"""LLM construction — turns the app's LLM settings (or backend env) into a
CrewAI LLM the agents reason with. One place so model/key handling stays consistent.
"""
from __future__ import annotations

import os

from crewai import LLM

# CrewAI injects an Anthropic-style prompt-cache breakpoint into the system
# message; Groq rejects it ("property 'cache_breakpoint' is unsupported").
# drop_params/modify_params don't reach inside the message, so we wrap
# litellm.completion (the call CrewAI ultimately makes) and recursively strip any
# `cache_control` / `cache_breakpoint` keys from the messages before they're sent.
def _scrub_cache(obj):
    if isinstance(obj, dict):
        obj.pop("cache_control", None)
        obj.pop("cache_breakpoint", None)
        for v in obj.values():
            _scrub_cache(v)
    elif isinstance(obj, list):
        for v in obj:
            _scrub_cache(v)
    return obj


try:  # pragma: no cover - litellm is always present in the image
    import litellm

    litellm.drop_params = True
    litellm.modify_params = True

    if not getattr(litellm, "_cache_scrub_patched", False):
        _orig_completion = litellm.completion

        def _patched_completion(*args, **kwargs):
            if kwargs.get("messages"):
                _scrub_cache(kwargs["messages"])
            return _orig_completion(*args, **kwargs)

        litellm.completion = _patched_completion
        litellm._cache_scrub_patched = True
except Exception:
    pass


def make_llm(settings: dict | None = None) -> LLM:
    """Build the agents' LLM.

    The browser's LLM settings are only trusted when they point at a real,
    reachable endpoint with a key (the "Custom API" engine). The "Groq" engine
    uses base_url="/llm" — a browser-only proxy path that is meaningless on the
    server — so in that case (and Template) we fall back entirely to the backend's
    own env (Render: LLM_BASE_URL / LLM_MODEL / LLM_API_KEY), which is configured
    correctly. This avoids the "Failed to connect to OpenAI API" error caused by
    a relative base_url + unprefixed model leaking through.
    """
    settings = settings or {}
    b_url = (settings.get("baseUrl") or "").strip()
    b_key = (settings.get("apiKey") or "").strip()
    b_model = (settings.get("model") or "").strip()

    use_browser = b_url.startswith("http") and bool(b_key)

    if use_browser:
        base_url, api_key, model = b_url, b_key, b_model
    else:
        base_url = os.environ.get("LLM_BASE_URL", "").strip()
        api_key = os.environ.get("LLM_API_KEY", "").strip()
        model = os.environ.get("LLM_MODEL", "").strip()

    model = model or "llama-3.3-70b-versatile"

    # Route through litellm's OpenAI-compatible handler against the configured
    # base_url (Groq exposes /openai/v1). We deliberately AVOID the native "groq/"
    # provider because CrewAI/litellm injects an Anthropic-style prompt-cache
    # breakpoint into the system message that Groq's groq/ endpoint rejects
    # ("property 'cache_breakpoint' is unsupported"). The openai/ path doesn't.
    if base_url:
        name = model.split("/", 1)[1] if "/" in model else model
        kwargs: dict = {"model": f"openai/{name}", "base_url": base_url}
        if api_key:
            kwargs["api_key"] = api_key
        return LLM(**kwargs)

    kwargs = {"model": model}
    if api_key:
        kwargs["api_key"] = api_key
    return LLM(**kwargs)
