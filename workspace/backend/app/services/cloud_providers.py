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
    # ── Tier 1: Major providers ───────────────────────────────────────
    "openai": ProviderInfo(
        name="openai",
        label="OpenAI",
        base_url=None,
        models=[
            ModelInfo("gpt-4o", "chat", "GPT-4o"),
            ModelInfo("gpt-4o-mini", "chat", "GPT-4o Mini"),
            ModelInfo("o3-mini", "chat", "o3 Mini"),
            ModelInfo("gpt-image-1", "image", "GPT Image"),
            ModelInfo("dall-e-3", "image", "DALL-E 3"),
        ],
    ),
    "anthropic": ProviderInfo(
        name="anthropic",
        label="Anthropic",
        base_url=None,  # uses custom adapter
        models=[
            ModelInfo("claude-sonnet-4-6", "chat", "Claude Sonnet 4.6"),
            ModelInfo("claude-haiku-4-5", "chat", "Claude Haiku 4.5"),
            ModelInfo("claude-opus-4-6", "chat", "Claude Opus 4.6"),
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
    "mistral": ProviderInfo(
        name="mistral",
        label="Mistral AI",
        base_url="https://api.mistral.ai/v1",
        models=[
            ModelInfo("mistral-large-latest", "chat", "Mistral Large"),
            ModelInfo("mistral-small-latest", "chat", "Mistral Small"),
            ModelInfo("codestral-latest", "chat", "Codestral"),
        ],
    ),
    # ── Tier 2: Research & search ─────────────────────────────────────
    "perplexity": ProviderInfo(
        name="perplexity",
        label="Perplexity",
        base_url=None,  # uses custom adapter
        models=[
            ModelInfo("sonar-pro", "chat", "Sonar Pro"),
            ModelInfo("sonar", "chat", "Sonar"),
        ],
    ),
    # ── Tier 3: Inference platforms ───────────────────────────────────
    "groq": ProviderInfo(
        name="groq",
        label="Groq",
        base_url="https://api.groq.com/openai/v1",
        models=[
            ModelInfo("llama-3.3-70b-versatile", "chat", "Llama 3.3 70B"),
            ModelInfo("llama-3.1-8b-instant", "chat", "Llama 3.1 8B"),
            ModelInfo("gemma2-9b-it", "chat", "Gemma 2 9B"),
        ],
    ),
    "together": ProviderInfo(
        name="together",
        label="Together AI",
        base_url="https://api.together.ai/v1",
        models=[
            ModelInfo("meta-llama/Llama-3.3-70B-Instruct-Turbo", "chat", "Llama 3.3 70B"),
            ModelInfo("Qwen/Qwen2.5-72B-Instruct-Turbo", "chat", "Qwen 2.5 72B"),
            ModelInfo("deepseek-ai/DeepSeek-R1", "chat", "DeepSeek R1"),
            ModelInfo("mistralai/Mixtral-8x22B-Instruct-v0.1", "chat", "Mixtral 8x22B"),
        ],
    ),
    "fireworks": ProviderInfo(
        name="fireworks",
        label="Fireworks AI",
        base_url="https://api.fireworks.ai/inference/v1",
        models=[
            ModelInfo("accounts/fireworks/models/llama-v3p3-70b-instruct", "chat", "Llama 3.3 70B"),
            ModelInfo("accounts/fireworks/models/deepseek-v3", "chat", "DeepSeek V3"),
            ModelInfo("accounts/fireworks/models/qwen2p5-72b-instruct", "chat", "Qwen 2.5 72B"),
        ],
    ),
    "openrouter": ProviderInfo(
        name="openrouter",
        label="OpenRouter",
        base_url="https://openrouter.ai/api/v1",
        models=[
            ModelInfo("anthropic/claude-sonnet-4", "chat", "Claude Sonnet 4"),
            ModelInfo("openai/gpt-4o", "chat", "GPT-4o"),
            ModelInfo("google/gemini-2.5-pro", "chat", "Gemini 2.5 Pro"),
            ModelInfo("meta-llama/llama-3.3-70b-instruct", "chat", "Llama 3.3 70B"),
        ],
    ),
    "sambanova": ProviderInfo(
        name="sambanova",
        label="SambaNova",
        base_url="https://api.sambanova.ai/v1",
        models=[
            ModelInfo("Meta-Llama-3.3-70B-Instruct", "chat", "Llama 3.3 70B"),
            ModelInfo("DeepSeek-R1", "chat", "DeepSeek R1"),
        ],
    ),
    "cerebras": ProviderInfo(
        name="cerebras",
        label="Cerebras",
        base_url="https://api.cerebras.ai/v1",
        models=[
            ModelInfo("llama-3.3-70b", "chat", "Llama 3.3 70B"),
        ],
    ),
    # ── Tier 4: Media generation ──────────────────────────────────────
    "stability": ProviderInfo(
        name="stability",
        label="Stability AI",
        base_url=None,  # custom adapter
        models=[
            ModelInfo("sd3.5-large", "image", "Stable Diffusion 3.5 Large"),
            ModelInfo("sd3.5-medium", "image", "Stable Diffusion 3.5 Medium"),
            ModelInfo("stable-image-ultra", "image", "Stable Image Ultra"),
            ModelInfo("stable-image-core", "image", "Stable Image Core"),
        ],
    ),
    "replicate": ProviderInfo(
        name="replicate",
        label="Replicate",
        base_url=None,  # custom adapter
        models=[
            ModelInfo("black-forest-labs/flux-1.1-pro", "image", "Flux 1.1 Pro"),
            ModelInfo("black-forest-labs/flux-schnell", "image", "Flux Schnell"),
            ModelInfo("stability-ai/sdxl", "image", "SDXL"),
        ],
    ),
    "fal": ProviderInfo(
        name="fal",
        label="fal.ai",
        base_url=None,  # custom adapter
        models=[
            ModelInfo("fal-ai/flux-pro/v1.1", "image", "Flux Pro 1.1"),
            ModelInfo("fal-ai/flux/schnell", "image", "Flux Schnell"),
            ModelInfo("fal-ai/stable-diffusion-v3-medium", "image", "SD3 Medium"),
        ],
    ),
    "elevenlabs": ProviderInfo(
        name="elevenlabs",
        label="ElevenLabs",
        base_url=None,  # custom adapter
        models=[
            ModelInfo("eleven_multilingual_v2", "audio", "Multilingual V2"),
            ModelInfo("eleven_turbo_v2_5", "audio", "Turbo V2.5"),
        ],
    ),
    # ── Custom endpoint ───────────────────────────────────────────────
    "custom": ProviderInfo(
        name="custom",
        label="Custom Endpoint",
        base_url=None,
        models=[],
    ),
}


def get_provider(name: str) -> Optional[ProviderInfo]:
    return PROVIDERS.get(name)


def validate_provider_model(provider: str, model: str) -> Optional[ModelInfo]:
    if provider == "custom":
        return ModelInfo(model, "chat", model)
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

def _make_client(api_key: str, provider: str, base_url_override: Optional[str] = None) -> AsyncOpenAI:
    if base_url_override:
        base_url = base_url_override.rstrip("/")
        if not base_url.endswith("/v1"):
            base_url = base_url + "/v1"
        return AsyncOpenAI(api_key=api_key, base_url=base_url)
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
    base_url: Optional[str] = None,
) -> str:
    """Call a chat completion API and return the text response."""
    if provider == "anthropic":
        return await _anthropic_chat(api_key, model, messages, system_prompt, max_tokens)
    if provider == "perplexity":
        return await _perplexity_chat(api_key, model, messages, system_prompt, max_tokens)

    client = _make_client(api_key, provider, base_url_override=base_url)

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


async def _anthropic_chat(
    api_key: str, model: str, messages: list[dict],
    system_prompt: Optional[str] = None, max_tokens: Optional[int] = None,
) -> str:
    """Call Anthropic's /v1/messages API."""
    import httpx
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    body: dict = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens or 4096,
    }
    if system_prompt:
        body["system"] = system_prompt

    async with httpx.AsyncClient(timeout=120) as http:
        r = await http.post("https://api.anthropic.com/v1/messages", headers=headers, json=body)
        r.raise_for_status()
        data = r.json()
        content_blocks = data.get("content", [])
        return "".join(b.get("text", "") for b in content_blocks if b.get("type") == "text")


async def _perplexity_chat(
    api_key: str, model: str, messages: list[dict],
    system_prompt: Optional[str] = None, max_tokens: Optional[int] = None,
) -> str:
    """Call Perplexity's chat completions API (OpenAI-like but at their own URL)."""
    import httpx
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    api_messages = []
    if system_prompt:
        api_messages.append({"role": "system", "content": system_prompt})
    api_messages.extend(messages)

    body: dict = {"model": model, "messages": api_messages}
    if max_tokens:
        body["max_tokens"] = max_tokens

    async with httpx.AsyncClient(timeout=120) as http:
        r = await http.post("https://api.perplexity.ai/chat/completions", headers=headers, json=body)
        r.raise_for_status()
        data = r.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        citations = data.get("citations", [])
        if citations:
            content += "\n\n**Sources:**\n" + "\n".join(f"- {c}" for c in citations[:5])
        return content


async def image_generation(
    api_key: str,
    provider: str,
    model: str,
    prompt: str,
    base_url: Optional[str] = None,
) -> tuple[bytes, str]:
    """Call an image generation API. Returns (image_bytes, format)."""
    if provider == "stability":
        return await _stability_image(api_key, model, prompt)
    if provider == "replicate":
        return await _replicate_image(api_key, model, prompt)
    if provider == "fal":
        return await _fal_image(api_key, model, prompt)

    client = _make_client(api_key, provider, base_url_override=base_url)

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


async def audio_generation(
    api_key: str,
    provider: str,
    model: str,
    text: str,
) -> tuple[bytes, str]:
    """Call a text-to-speech API. Returns (audio_bytes, format)."""
    if provider == "elevenlabs":
        return await _elevenlabs_tts(api_key, model, text)
    raise ValueError(f"Audio generation not supported for provider: {provider}")


# ---------------------------------------------------------------------------
# Media platform adapters
# ---------------------------------------------------------------------------

async def _stability_image(api_key: str, model: str, prompt: str) -> tuple[bytes, str]:
    """Call Stability AI's image generation API."""
    import httpx
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "image/*",
    }
    if model.startswith("stable-image"):
        url = f"https://api.stability.ai/v2beta/stable-image/generate/{model.replace('stable-image-', '')}"
    else:
        url = f"https://api.stability.ai/v2beta/stable-image/generate/sd3"

    async with httpx.AsyncClient(timeout=120) as http:
        r = await http.post(url, headers=headers, data={"prompt": prompt, "model": model, "output_format": "png"})
        r.raise_for_status()
        return r.content, "png"


async def _replicate_image(api_key: str, model: str, prompt: str) -> tuple[bytes, str]:
    """Call Replicate's prediction API and poll for result."""
    import httpx
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=300) as http:
        r = await http.post(
            "https://api.replicate.com/v1/predictions",
            headers=headers,
            json={"model": model, "input": {"prompt": prompt}},
        )
        r.raise_for_status()
        prediction = r.json()

        poll_url = prediction.get("urls", {}).get("get", f"https://api.replicate.com/v1/predictions/{prediction['id']}")
        import asyncio
        for _ in range(60):
            await asyncio.sleep(2)
            r = await http.get(poll_url, headers=headers)
            r.raise_for_status()
            data = r.json()
            if data["status"] == "succeeded":
                output = data.get("output")
                image_url = output[0] if isinstance(output, list) else output
                img_r = await http.get(image_url)
                img_r.raise_for_status()
                return img_r.content, "png"
            if data["status"] == "failed":
                raise ValueError(f"Replicate prediction failed: {data.get('error')}")

        raise ValueError("Replicate prediction timed out")


async def _fal_image(api_key: str, model: str, prompt: str) -> tuple[bytes, str]:
    """Call fal.ai's image generation API."""
    import httpx
    headers = {
        "Authorization": f"Key {api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=120) as http:
        r = await http.post(
            f"https://fal.run/{model}",
            headers=headers,
            json={"prompt": prompt},
        )
        r.raise_for_status()
        data = r.json()
        images = data.get("images", [])
        if not images:
            raise ValueError("No images in fal.ai response")
        image_url = images[0].get("url", "")
        img_r = await http.get(image_url)
        img_r.raise_for_status()
        return img_r.content, "png"


async def _elevenlabs_tts(api_key: str, model: str, text: str) -> tuple[bytes, str]:
    """Call ElevenLabs text-to-speech API."""
    import httpx
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60) as http:
        r = await http.post(
            "https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM",
            headers=headers,
            json={"text": text, "model_id": model},
        )
        r.raise_for_status()
        return r.content, "mp3"
