import { useEffect, useState } from 'react';

import { ipc } from '../lib/api';

// Slugs that are bundled with the renderer (`src/renderer/icons/*.svg`).
const BUNDLED_AGENT_ICON_SLUGS = new Set([
  'aider',
  'amp',
  'claude',
  'cline',
  'codex',
  'copilot',
  'cursor',
  'gemini',
  'goose',
  'kimi',
  'nanoclaw',
  'openai',
  'openclaw',
  'opencode',
  'swebench',
  'yaml-agent',
]);

interface IconResolver {
  iconUrl(type: string): string;
}

/**
 * Resolves icon URLs for agent types. Prefers bundled SVGs; falls back to
 * the core library's icons directory loaded from the main process.
 */
export function useIconResolver(): IconResolver {
  const [coreIconsDir, setCoreIconsDir] = useState<string | null>(null);

  useEffect(() => {
    void ipc().getIconsDir().then((dir) => setCoreIconsDir(dir));
  }, []);

  return {
    iconUrl(type: string): string {
      const slug = (type || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (BUNDLED_AGENT_ICON_SLUGS.has(slug)) {
        return new URL(`../icons/${slug}.svg`, import.meta.url).href;
      }
      if (coreIconsDir) {
        return `file://${coreIconsDir}/${slug}.svg`;
      }
      return new URL('../icons/default.svg', import.meta.url).href;
    },
  };
}
