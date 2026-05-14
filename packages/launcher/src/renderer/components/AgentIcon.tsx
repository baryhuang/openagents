import React from "react"

const BUNDLED_SLUGS = new Set([
  "aider",
  "amp",
  "claude",
  "cline",
  "codex",
  "copilot",
  "cursor",
  "default",
  "gemini",
  "goose",
  "kimi",
  "nanoclaw",
  "openai",
  "openclaw",
  "opencode",
  "swebench",
  "yaml-agent",
])

interface AgentIconProps {
  type: string
  size?: number
  className?: string
}

export default function AgentIcon({
  type,
  size = 24,
  className,
}: AgentIconProps): React.JSX.Element {
  const slug = (type || "").toLowerCase().replace(/[^a-z0-9-]/g, "")
  const iconSlug = BUNDLED_SLUGS.has(slug) ? slug : "default"
  return (
    <img
      src={`icons/${iconSlug}.svg`}
      width={size}
      height={size}
      alt={type}
      className={className}
      style={{ borderRadius: 6, flexShrink: 0 }}
    />
  )
}
