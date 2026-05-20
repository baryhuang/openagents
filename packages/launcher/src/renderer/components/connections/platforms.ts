import type { ConnectionAuthKind, CredentialKind, PlatformId } from '../../types'

export interface PlatformDef {
  id: PlatformId
  label: string
  /** Short tagline shown under the card title. */
  blurb: string
  /** Single-character glyph fallback when no logo is available. */
  glyph: string
  /** Background tint applied to the glyph chip. */
  tint: string
  authKinds: ConnectionAuthKind[]
  /** Preferred credential kind for "Connect" flow. */
  defaultCredentialKind: CredentialKind
  /** Human-readable docs URL for "where to get the token". */
  docs?: string
  /** Suggested scopes shown as chips in the connect dialog. */
  suggestedScopes?: string[]
  /** OAuth start URL — for future deep-link / browser-auth flows. */
  oauthStart?: string
  /**
   * Default env-var name used when applying a credential to an agent's .env
   * file. Bridges the encrypted Credentials store to the agent-launcher's
   * resolve_env system. (stage.md §4.4 — image: "src/env.js 增强")
   */
  defaultEnvKey?: string
}

export const PLATFORMS: PlatformDef[] = [
  {
    id: 'github',
    label: 'GitHub',
    blurb: 'Repos, issues, pull requests, Actions',
    glyph: 'G',
    tint: '#24292f',
    authKinds: ['pat', 'oauth', 'app'],
    defaultCredentialKind: 'token',
    docs: 'https://github.com/settings/tokens',
    suggestedScopes: ['repo', 'workflow', 'read:user'],
    defaultEnvKey: 'GITHUB_TOKEN',
  },
  {
    id: 'slack',
    label: 'Slack',
    blurb: 'Channels, bot tokens, slash commands',
    glyph: 'S',
    tint: '#4A154B',
    authKinds: ['oauth', 'token'],
    defaultCredentialKind: 'token',
    docs: 'https://api.slack.com/authentication/token-types',
    suggestedScopes: ['chat:write', 'channels:read', 'users:read'],
    defaultEnvKey: 'SLACK_BOT_TOKEN',
  },
  {
    id: 'discord',
    label: 'Discord',
    blurb: 'Bot connection, guilds, messaging',
    glyph: 'D',
    tint: '#5865F2',
    authKinds: ['token', 'webhook'],
    defaultCredentialKind: 'token',
    docs: 'https://discord.com/developers/applications',
    defaultEnvKey: 'DISCORD_BOT_TOKEN',
  },
  {
    id: 'telegram',
    label: 'Telegram',
    blurb: 'Bot token, chats, commands',
    glyph: 'T',
    tint: '#26A5E4',
    authKinds: ['token'],
    defaultCredentialKind: 'token',
    docs: 'https://core.telegram.org/bots#how-do-i-create-a-bot',
    defaultEnvKey: 'TELEGRAM_BOT_TOKEN',
  },
  {
    id: 'notion',
    label: 'Notion',
    blurb: 'Pages, databases, search',
    glyph: 'N',
    tint: '#000000',
    authKinds: ['oauth', 'token'],
    defaultCredentialKind: 'token',
    docs: 'https://www.notion.so/my-integrations',
    defaultEnvKey: 'NOTION_API_KEY',
  },
  {
    id: 'linear',
    label: 'Linear',
    blurb: 'Issues, projects, cycles',
    glyph: 'L',
    tint: '#5E6AD2',
    authKinds: ['oauth', 'token'],
    defaultCredentialKind: 'token',
    docs: 'https://linear.app/settings/api',
    defaultEnvKey: 'LINEAR_API_KEY',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    blurb: 'GPT models, embeddings',
    glyph: 'O',
    tint: '#10A37F',
    authKinds: ['token'],
    defaultCredentialKind: 'api_key',
    docs: 'https://platform.openai.com/api-keys',
    defaultEnvKey: 'OPENAI_API_KEY',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    blurb: 'Claude models',
    glyph: 'A',
    tint: '#CC785C',
    authKinds: ['token'],
    defaultCredentialKind: 'api_key',
    docs: 'https://console.anthropic.com/settings/keys',
    defaultEnvKey: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'google',
    label: 'Google',
    blurb: 'Gemini, AI Studio',
    glyph: 'G',
    tint: '#4285F4',
    authKinds: ['token', 'oauth'],
    defaultCredentialKind: 'api_key',
    docs: 'https://aistudio.google.com/app/apikey',
    defaultEnvKey: 'GOOGLE_API_KEY',
  },
]

export function getPlatform(id: string): PlatformDef | undefined {
  return PLATFORMS.find((p) => p.id === id)
}

export function platformLabel(id: string): string {
  return getPlatform(id)?.label ?? id
}
