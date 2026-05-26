'use client';

import { cn } from '@/lib/utils';

interface IconProps {
  className?: string;
  size?: number;
}

function Svg({ children, className, size = 20, viewBox = '0 0 24 24' }: IconProps & { children: React.ReactNode; viewBox?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox={viewBox} className={className} fill="none">
      {children}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Local agent icons
// ---------------------------------------------------------------------------

export function ClaudeIcon({ className, size }: IconProps) {
  return (
    <Svg size={size} className={className} viewBox="0 0 24 24">
      <path d="M16.28 11.9l-4.76 8.24a.5.5 0 01-.87 0L5.73 9.87a.5.5 0 01.43-.75h3.08a.5.5 0 01.43.25l3.17 5.49 2.02-3.5a.5.5 0 01.87 0l1.97 3.41a.5.5 0 01-.43.75h0z" fill="#D97706" />
      <path d="M14.14 6.38l-2.56 4.44a.5.5 0 01-.87 0L8.16 6.38a.5.5 0 01.43-.75h5.12a.5.5 0 01.43.75z" fill="#D97706" />
    </Svg>
  );
}

export function CodexIcon({ className, size }: IconProps) {
  return (
    <Svg size={size} className={className} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" fill="#10A37F" />
      <path d="M12 7v5l3.5 3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="1.5" fill="white" />
    </Svg>
  );
}

export function GeminiIcon({ className, size }: IconProps) {
  return (
    <Svg size={size} className={className} viewBox="0 0 24 24">
      <path d="M12 3C12 3 7 8 7 12s5 9 5 9 5-5 5-9-5-9-5-9z" fill="#4285F4" />
      <path d="M12 3C12 3 17 8 17 12s-5 9-5 9" fill="#34A853" />
    </Svg>
  );
}

export function OpenClawIcon({ className, size }: IconProps) {
  return (
    <Svg size={size} className={className} viewBox="0 0 24 24">
      <rect x="4" y="4" width="16" height="16" rx="4" fill="#7C3AED" />
      <path d="M8 12h8M12 8v8" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

export function AmpIcon({ className, size }: IconProps) {
  return (
    <Svg size={size} className={className} viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#F43F5E" />
      <path d="M13 7l-4 5h6l-4 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function AiderIcon({ className, size }: IconProps) {
  return (
    <Svg size={size} className={className} viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#10B981" />
      <path d="M8 16l4-10 4 10M9.5 13h5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function GooseIcon({ className, size }: IconProps) {
  return (
    <Svg size={size} className={className} viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#D97706" />
      <path d="M12 7c-2 0-4 2-4 4.5S10 17 12 17s4-3.5 4-5.5S14 7 12 7z" stroke="white" strokeWidth="1.5" fill="none" />
      <circle cx="10.5" cy="11" r="1" fill="white" />
    </Svg>
  );
}

export function ClineIcon({ className, size }: IconProps) {
  return (
    <Svg size={size} className={className} viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#06B6D4" />
      <path d="M14 8l-4 4 4 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CopilotIcon({ className, size }: IconProps) {
  return (
    <Svg size={size} className={className} viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#6366F1" />
      <path d="M8 12a4 4 0 018 0v2a4 4 0 01-8 0v-2z" stroke="white" strokeWidth="1.5" fill="none" />
      <circle cx="10" cy="12" r="1" fill="white" />
      <circle cx="14" cy="12" r="1" fill="white" />
    </Svg>
  );
}

export function OpenCodeIcon({ className, size }: IconProps) {
  return (
    <Svg size={size} className={className} viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#14B8A6" />
      <path d="M9 8l-3 4 3 4M15 8l3 4-3 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function NanoClawIcon({ className, size }: IconProps) {
  return (
    <Svg size={size} className={className} viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#EC4899" />
      <path d="M8 10l4-3 4 3M8 14l4 3 4-3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Cloud provider icons
// ---------------------------------------------------------------------------

export function OpenAIIcon({ className, size }: IconProps) {
  return (
    <Svg size={size} className={className} viewBox="0 0 24 24">
      <path d="M22.28 9.37a5.89 5.89 0 00-.51-4.85 5.96 5.96 0 00-6.43-2.83A5.89 5.89 0 0011.02 0a5.97 5.97 0 00-5.69 4.13 5.89 5.89 0 00-3.94 2.86 5.97 5.97 0 00.74 6.99 5.89 5.89 0 00.51 4.85 5.96 5.96 0 006.43 2.83A5.89 5.89 0 0013.39 24a5.97 5.97 0 005.69-4.13 5.89 5.89 0 003.94-2.86 5.97 5.97 0 00-.74-6.99zM13.39 22.34a4.38 4.38 0 01-2.82-1.03l.14-.08 4.68-2.7a.76.76 0 00.38-.66v-6.6l1.98 1.14a.07.07 0 01.04.05v5.47a4.42 4.42 0 01-4.4 4.41zM3.55 18.19a4.38 4.38 0 01-.52-2.95l.14.08 4.68 2.7a.76.76 0 00.76 0l5.71-3.3v2.28a.07.07 0 01-.03.06l-4.73 2.73a4.42 4.42 0 01-6.01-1.6zM2.17 7.88a4.38 4.38 0 012.3-1.93v5.55a.76.76 0 00.38.66l5.71 3.3-1.98 1.14a.07.07 0 01-.06 0L3.79 13.87a4.42 4.42 0 01-1.62-6zM19.22 11.87l-5.71-3.3 1.98-1.14a.07.07 0 01.06 0l4.73 2.73a4.41 4.41 0 01-.68 7.95v-5.58a.76.76 0 00-.38-.66zM21.2 8.76l-.14-.08-4.68-2.7a.76.76 0 00-.76 0l-5.71 3.3V7a.07.07 0 01.03-.06l4.73-2.73a4.42 4.42 0 016.53 4.55zM8.33 13.33l-1.98-1.14a.07.07 0 01-.04-.06V6.66a4.42 4.42 0 017.22-3.38l-.14.08-4.68 2.7a.76.76 0 00-.38.66v6.6zM9.31 11l2.54-1.47L14.4 11v2.93l-2.54 1.47-2.54-1.47V11z" fill="currentColor" />
    </Svg>
  );
}

export function GoogleAIIcon({ className, size }: IconProps) {
  return (
    <Svg size={size} className={className} viewBox="0 0 24 24">
      <path d="M12 11v2.4h6.46c-.28 1.48-1.12 2.73-2.38 3.57l3.84 2.98c2.24-2.07 3.53-5.1 3.53-8.71 0-.84-.08-1.65-.22-2.44H12z" fill="#4285F4" />
      <path d="M5.27 14.27l-.86.66-2.45 1.91c1.96 3.89 5.98 6.56 10.58 6.56 3.2 0 5.89-1.06 7.85-2.87l-3.84-2.98c-1.06.71-2.42 1.13-4.01 1.13-3.08 0-5.69-2.08-6.63-4.88l-.64.47z" fill="#34A853" />
      <path d="M1.96 6.6C1.35 7.8 1 9.15 1 10.56s.35 2.76.96 3.96l4.31-3.35c-.25-.75-.38-1.54-.38-2.37s.13-1.62.38-2.37L1.96 6.6z" fill="#FBBC05" />
      <path d="M12.54 4.27c1.74 0 3.3.6 4.53 1.78L20.04 3.1C18.01 1.19 15.32.04 12.54.04 7.94.04 3.92 2.71 1.96 6.6l4.31 3.35c.94-2.8 3.55-4.88 6.63-4.88l-.36-.8z" fill="#EA4335" />
    </Svg>
  );
}

export function XAIIcon({ className, size }: IconProps) {
  return (
    <Svg size={size} className={className} viewBox="0 0 24 24">
      <path d="M4 4l7.2 10.5L4 20h1.6l6.4-4.8L18.4 20H20l-7.6-10.5L19.6 4H18l-6 4.5L5.6 4H4z" fill="currentColor" />
    </Svg>
  );
}

export function DeepSeekIcon({ className, size }: IconProps) {
  return (
    <Svg size={size} className={className} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" fill="#0066FF" />
      <path d="M7 12a5 5 0 0110 0" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <path d="M9 12a3 3 0 016 0" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.5" fill="white" />
    </Svg>
  );
}

export function CustomEndpointIcon({ className, size }: IconProps) {
  return (
    <Svg size={size} className={className} viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#71717A" />
      <path d="M8 10h8M8 14h5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="17" cy="14" r="1.5" fill="white" />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Lookup maps
// ---------------------------------------------------------------------------

const LOCAL_AGENT_ICONS: Record<string, React.FC<IconProps>> = {
  claude: ClaudeIcon,
  codex: CodexIcon,
  gemini: GeminiIcon,
  openclaw: OpenClawIcon,
  amp: AmpIcon,
  aider: AiderIcon,
  goose: GooseIcon,
  cline: ClineIcon,
  copilot: CopilotIcon,
  opencode: OpenCodeIcon,
  nanoclaw: NanoClawIcon,
};

const CLOUD_PROVIDER_ICONS: Record<string, React.FC<IconProps>> = {
  openai: OpenAIIcon,
  google: GoogleAIIcon,
  xai: XAIIcon,
  deepseek: DeepSeekIcon,
  custom: CustomEndpointIcon,
};

export function AgentIcon({ name, className, size = 20 }: { name: string } & IconProps) {
  const Icon = LOCAL_AGENT_ICONS[name];
  if (Icon) return <Icon className={className} size={size} />;
  return null;
}

export function ProviderIcon({ name, className, size = 20 }: { name: string } & IconProps) {
  const Icon = CLOUD_PROVIDER_ICONS[name];
  if (Icon) return <Icon className={className} size={size} />;
  return null;
}
