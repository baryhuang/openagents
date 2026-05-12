/**
 * Kimi adapter — Moonshot AI OpenAI-compatible chat completions.
 *
 * Reuses LlmDirectAdapter's streaming chat-completions client, but:
 *  - reads KIMI_API_KEY / MOONSHOT_API_KEY (also accepts LLM_API_KEY / OPENAI_API_KEY)
 *  - reads KIMI_BASE_URL / LLM_BASE_URL / OPENAI_BASE_URL, defaulting to https://api.moonshot.ai/v1
 *  - reads KIMI_MODEL / LLM_MODEL, defaulting to kimi-k2.6
 *
 * Priority for every value: UI-saved env > process env > default.
 * Stop / status / control flow is inherited from BaseAdapter.
 */

'use strict';

const LlmDirectAdapter = require('./llm-direct');

const DEFAULT_BASE_URL = 'https://api.moonshot.ai/v1';
const DEFAULT_MODEL = 'kimi-k2.6';

class KimiAdapter extends LlmDirectAdapter {
  constructor(opts) {
    super({
      ...opts,
      adapterLabel: 'Kimi',
      modelEnvVar: 'KIMI_MODEL',
      suppressConfigLog: true,
    });

    const env = this.agentEnv || process.env;

    const apiKey =
      env.KIMI_API_KEY ||
      env.MOONSHOT_API_KEY ||
      env.LLM_API_KEY ||
      env.OPENAI_API_KEY ||
      '';

    const baseUrl = (
      env.KIMI_BASE_URL ||
      env.LLM_BASE_URL ||
      env.OPENAI_BASE_URL ||
      DEFAULT_BASE_URL
    ).replace(/\/$/, '');

    const model =
      env.KIMI_MODEL ||
      env.LLM_MODEL ||
      DEFAULT_MODEL;

    this._apiKey = apiKey;
    this._baseUrl = baseUrl;
    this._model = model;
    this._directMode = !!(this._apiKey && this._baseUrl);

    if (this._directMode) {
      this._log(`Kimi mode: ${this._baseUrl} model=${this._model}`);
    } else {
      this._log(
        'Kimi adapter started without API key. ' +
        'Set KIMI_API_KEY (or MOONSHOT_API_KEY) via the Launcher Configure screen.'
      );
    }
  }
}

module.exports = KimiAdapter;
