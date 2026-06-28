"""LLM construction — turns the app's LLM settings (or backend env) into a
CrewAI LLM the agents reason with. One place so model/key handling stays consistent.
"""
from __future__ import annotations

import os

from crewai import LLM


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

    # Route through CrewAI's NATIVE "openai" provider against an OpenAI-compatible
    # endpoint (Groq, OpenAI, OpenRouter, …). This needs no litellm fallback —
    # "openai" is a built-in provider — so the container build stays lean.
    # A "groq/…" style prefix is stripped; the base_url decides the real endpoint.
    if base_url:
        name = model.split("/", 1)[1] if "/" in model else model
        kwargs: dict = {"model": f"openai/{name}", "base_url": base_url}
        if api_key:
            kwargs["api_key"] = api_key
        return LLM(**kwargs)

    # No base_url: trust the model string as-is (e.g. a provider-prefixed model).
    kwargs = {"model": model}
    if api_key:
        kwargs["api_key"] = api_key
    return LLM(**kwargs)
