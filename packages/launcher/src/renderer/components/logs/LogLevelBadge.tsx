import React from "react"
import type { LogLevel } from "../../services/logs/log-parser"

const META: Record<LogLevel, { label: string; bg: string; fg: string }> = {
  error: { label: "ERROR", bg: "var(--danger-bg)", fg: "var(--danger-text)" },
  warn: { label: "WARN", bg: "var(--warning-bg)", fg: "var(--warning-text)" },
  info: { label: "INFO", bg: "var(--accent-bg)", fg: "var(--accent)" },
  debug: { label: "DEBUG", bg: "var(--bg-input)", fg: "var(--text-secondary)" },
  trace: { label: "TRACE", bg: "var(--bg-input)", fg: "var(--text-tertiary)" },
  unknown: { label: "LOG", bg: "var(--bg-input)", fg: "var(--text-tertiary)" },
}

export function LogLevelBadge({ level }: { level: LogLevel }): React.JSX.Element {
  const m = META[level]
  return (
    <span
      className="inline-block min-w-[44px] text-center text-[9px] font-bold px-1.5 py-0.5 rounded-sm"
      style={{ background: m.bg, color: m.fg }}
    >
      {m.label}
    </span>
  )
}
