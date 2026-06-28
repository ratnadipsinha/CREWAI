"""LLM construction — turns the app's LLM settings (or backend env) into a
CrewAI LLM the agents reason with. One place so model/key handling stays consistent.
"""
from __future__ import annotations

import os

from crewai import LLM


def make_llm(settings: dict | None = None) -> LLM:
    settings = settings or {}
    model = settings.get("model") or os.environ.get("LLM_MODEL") or "groq/llama-3.3-70b-versatile"
    base_url = settings.get("baseUrl") or os.environ.get("LLM_BASE_URL") or ""
    api_key = settings.get("apiKey") or os.environ.get("LLM_API_KEY") or ""
    kwargs: dict = {"model": model}
    if base_url:
        kwargs["base_url"] = base_url
    if api_key:
        kwargs["api_key"] = api_key
    return LLM(**kwargs)
