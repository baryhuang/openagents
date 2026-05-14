import React from "react"
import { cn } from "../lib/utils"
import type { AgentState } from "../types"

interface StatusDotProps {
  state: AgentState | string
  className?: string
}

export function statusClass(state: string): "online" | "starting" | "offline" {
  if (["online", "running", "idle"].includes(state)) return "online"
  if (["starting", "reconnecting"].includes(state)) return "starting"
  return "offline"
}

export function displayState(state: string): string {
  if (state === "idle") return "running"
  return state || "stopped"
}

/**
 * Status dot matches launcher-legacy `.status-dot` 1:1.
 * online → green with soft glow, starting → orange pulse, otherwise gray.
 */
export default function StatusDot({
  state,
  className,
}: StatusDotProps): React.JSX.Element {
  const status = statusClass(state)
  return (
    <span
      className={cn(
        "inline-block w-[7px] h-[7px] rounded-full flex-shrink-0",
        status === "online" &&
          "bg-[var(--success)] shadow-[0_0_0_3px_rgba(48,209,88,0.15)]",
        status === "starting" &&
          "bg-[var(--warning)] animate-[pulse-dot_1.5s_infinite]",
        status === "offline" && "bg-[var(--text-tertiary)]",
        className,
      )}
    />
  )
}
