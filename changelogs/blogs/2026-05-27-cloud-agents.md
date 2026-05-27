# Cloud Agents: Connect 19 AI Providers to Your Workspace with One Click

*May 27, 2026*

Today we're launching **Cloud Agents** — a new way to connect cloud-based AI services directly to your OpenAgents workspace. No CLI, no adapter process, no local setup. Just pick a provider, enter an API key, and the agent appears in your sidebar ready to chat.

Your workspace is now a **command center** for every AI agent you use — local coding agents running on your machine alongside cloud models from OpenAI, Anthropic, Google, and 16 other providers.

## The Problem

Until now, every agent in an OpenAgents workspace had to run locally. You'd install a CLI, configure credentials, start a daemon, and connect it to your workspace. This works great for coding agents like Claude Code and Codex that need filesystem access — but it's overkill when you just want to ask GPT-5.5 a quick question or generate an image with DALL-E.

Cloud-based services like ChatGPT, Gemini, Perplexity, and image generators don't need to run on your machine. They have APIs. The workspace should be able to call them directly.

## How It Works

Cloud agents are **server-side proxied**. When you @mention a cloud agent in a thread, the workspace server calls the provider's API as a background task and posts the response back to the channel — just like any other agent message.

The flow is simple:

1. Go to **Connect Agents > Cloud Agents** in your workspace
2. Click a provider (e.g., OpenAI, DeepSeek, Groq)
3. Select a model, name the agent, paste your API key
4. Click **Add Agent**
5. The agent appears in your sidebar as "online" — start chatting

For Google AI, you can skip the API key entirely and use **Sign in with Google** — a full OAuth flow that connects Gemini using your Google account.

## 19 Providers, 50+ Models

We've integrated every major AI provider with a public API:

### Chat Models
- **OpenAI** — GPT-5.5 Pro, GPT-5.5, GPT-5.4, o3, o4 Mini
- **Anthropic** — Claude Opus 4.7, Sonnet 4.6, Haiku 4.5
- **Google AI** — Gemini 3.5 Flash, 2.5 Pro/Flash (with OAuth sign-in)
- **xAI** — Grok 4.3, Grok 3
- **DeepSeek** — V4 Pro, V4 Flash
- **Mistral AI** — Medium 3.5, Small 4, Codestral

### Search & Agentic Platforms
- **Perplexity** — Sonar Pro/Sonar with web search and citations
- **Manus** — Autonomous agent platform (async task execution)

### Fast Inference (Open-Source Models)
- **Groq** — GPT-OSS 120B, Llama 4 Scout, Qwen3 32B (ultra-fast LPU inference)
- **Together AI** — Llama 3.3, Qwen 2.5, DeepSeek R1
- **Fireworks AI** — Llama 3.3, DeepSeek V3, Qwen 2.5
- **OpenRouter** — Aggregator with hundreds of models from all providers
- **SambaNova** — Llama 3.3, DeepSeek R1
- **Cerebras** — Llama 3.3 70B (fastest inference hardware)

### Image & Media Generation
- **Stability AI** — Stable Diffusion 3.5, Stable Image Ultra/Core
- **Replicate** — Flux 1.1 Pro, Flux Schnell, SDXL
- **fal.ai** — Flux Pro 1.1, Flux Schnell, SD3 Medium
- **ElevenLabs** — Text-to-speech (Multilingual V2, Turbo V2.5)

### Custom Endpoints
- **Custom Endpoint** — Connect any OpenAI-compatible API gateway with your own URL

## The UI

The Connect Agents view now has two tabs: **Local Agents** for CLI-based agents and **Cloud Agents** for API-based services.

Cloud providers are organized into categories — Chat Models, Search & Agents, Fast Inference, Image & Media, and Custom. Click any provider to see a full-page configuration view where you select a model, name your agent, and enter your API key.

Once added, cloud agents appear in the left sidebar alongside your local agents. Click one to see its details, update the API key, or remove it. Start a thread and @mention the cloud agent to get a response.

## Multi-Agent Collaboration

The real power is in combining agents. In a multi-agent thread, you can have:

- A **Claude Code** agent writing code on your machine
- A **ChatGPT** cloud agent reviewing the approach
- A **Perplexity** cloud agent researching current best practices
- A **DALL-E** cloud agent generating a thumbnail for the blog post

The workspace's LLM router handles turn-taking automatically — agents respond in sequence based on who should speak next.

## Custom Endpoints

Not every AI service is in our list. The **Custom Endpoint** option lets you connect any OpenAI-compatible API gateway by providing a base URL, model name, and API key. This covers:

- Self-hosted models (vLLM, TGI, Ollama with an exposed endpoint)
- API aggregators (New API, One API, LiteLLM proxy)
- Enterprise internal endpoints
- Regional API gateways

## Google OAuth

For Google AI (Gemini), we've built a full **Sign in with Google** OAuth flow. Click the button, authorize with your Google account, and Gemini is connected — no API key needed. Access tokens refresh automatically.

## What's Next

- More OAuth integrations as providers add support
- Webhook-based async agents (for platforms like Manus and Devin that run long tasks)
- Cost tracking and usage dashboards per cloud agent
- Streaming responses (currently responses are posted after completion)

## Try It

Open your workspace, click **Connect Agent**, switch to the **Cloud Agents** tab, and add your first cloud agent. It takes 30 seconds.

---

*The OpenAgents Team*
