# -*- coding: utf-8 -*-
"""
Cloud agent provider registry and API client.

All supported providers expose OpenAI-compatible APIs, so the implementation
uses the openai library with a per-provider base_url.
"""

import base64
import logging
from dataclasses import dataclass, field
from typing import Optional

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Provider / model registry
# ---------------------------------------------------------------------------

@dataclass
class ModelInfo:
    id: str
    category: str   # "chat" or "image"
    label: str


@dataclass
class ProviderInfo:
    name: str
    label: str
    base_url: Optional[str]   # None = OpenAI default
    models: list[ModelInfo] = field(default_factory=list)


PROVIDERS: dict[str, ProviderInfo] = {
    "openai": ProviderInfo(
        name="openai",
        label="OpenAI",
        base_url=None,
        models=[
            ModelInfo("gpt-4o", "chat", "GPT-4o"),
            ModelInfo("gpt-4o-mini", "chat", "GPT-4o Mini"),
            ModelInfo("gpt-image-1", "image", "GPT Image"),
            ModelInfo("dall-e-3", "image", "DALL-E 3"),
        ],
    ),
    "google": ProviderInfo(
        name="google",
        label="Google AI",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        models=[
            ModelInfo("gemini-2.0-flash", "chat", "Gemini 2.0 Flash"),
            ModelInfo("gemini-2.5-flash", "chat", "Gemini 2.5 Flash"),
            ModelInfo("gemini-2.5-pro", "chat", "Gemini 2.5 Pro"),
        ],
    ),
    "xai": ProviderInfo(
        name="xai",
        label="xAI",
        base_url="https://api.x.ai/v1",
        models=[
            ModelInfo("grok-3", "chat", "Grok 3"),
            ModelInfo("grok-3-mini", "chat", "Grok 3 Mini"),
        ],
    ),
    "deepseek": ProviderInfo(
        name="deepseek",
        label="DeepSeek",
        base_url="https://api.deepseek.com",
        models=[
            ModelInfo("deepseek-chat", "chat", "DeepSeek Chat"),
            ModelInfo("deepseek-reasoner", "chat", "DeepSeek Reasoner"),
        ],
    ),
}


def get_provider(name: str) -> Optional[ProviderInfo]:
    return PROVIDERS.get(name)


def validate_provider_model(provider: str, model: str) -> Optional[ModelInfo]:
    prov = PROVIDERS.get(provider)
    if not prov:
        return None
    for m in prov.models:
        if m.id == model:
            return m
    return None


def providers_catalog() -> list[dict]:
    """Return the full provider catalog for the frontend."""
    return [
        {
            "name": p.name,
            "label": p.label,
            "models": [
                {"id": m.id, "category": m.category, "label": m.label}
                for m in p.models
            ],
        }
        for p in PROVIDERS.values()
    ]


# ---------------------------------------------------------------------------
# API client
# ---------------------------------------------------------------------------

def _make_client(api_key: str, provider: str) -> AsyncOpenAI:
    prov = PROVIDERS.get(provider)
    base_url = prov.base_url if prov else None
    return AsyncOpenAI(api_key=api_key, base_url=base_url)


async def chat_completion(
    api_key: str,
    provider: str,
    model: str,
    messages: list[dict],
    system_prompt: Optional[str] = None,
    max_tokens: Optional[int] = None,
) -> str:
    """Call a chat completion API and return the text response."""
    client = _make_client(api_key, provider)

    api_messages = []
    if system_prompt:
        api_messages.append({"role": "system", "content": system_prompt})
    api_messages.extend(messages)

    kwargs: dict = {"model": model, "messages": api_messages}
    if max_tokens:
        kwargs["max_tokens"] = max_tokens

    try:
        response = await client.chat.completions.create(**kwargs)
        return response.choices[0].message.content or ""
    finally:
        await client.close()


async def image_generation(
    api_key: str,
    provider: str,
    model: str,
    prompt: str,
) -> tuple[bytes, str]:
    """Call an image generation API. Returns (image_bytes, format)."""
    client = _make_client(api_key, provider)

    try:
        kwargs: dict = {"model": model, "prompt": prompt, "n": 1}
        if model == "dall-e-3":
            kwargs["size"] = "1024x1024"
            kwargs["response_format"] = "b64_json"
        elif model == "gpt-image-1":
            kwargs["size"] = "1024x1024"

        response = await client.images.generate(**kwargs)
        item = response.data[0]

        if hasattr(item, "b64_json") and item.b64_json:
            image_bytes = base64.b64decode(item.b64_json)
            return image_bytes, "png"

        if hasattr(item, "url") and item.url:
            import httpx
            async with httpx.AsyncClient() as http:
                r = await http.get(item.url)
                r.raise_for_status()
                return r.content, "png"

        raise ValueError("No image data in response")
    finally:
        await client.close()
