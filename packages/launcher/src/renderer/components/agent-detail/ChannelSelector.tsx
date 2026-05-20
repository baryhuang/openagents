import React from "react"
import { cn } from "../../lib/utils"
import type { UpdateChannel } from "../../hooks/useAgentChannel"

interface ChannelSelectorProps {
  value: UpdateChannel
  onChange: (next: UpdateChannel) => void
  className?: string
}

const OPTIONS: Array<{
  value: UpdateChannel
  label: string
  description: string
}> = [
  { value: "stable", label: "Stable", description: "Production releases (npm `@latest`)" },
  { value: "beta", label: "Beta", description: "Pre-release builds (`@beta`)" },
  { value: "nightly", label: "Nightly", description: "Cutting edge, may be unstable (`@nightly`)" },
]

/**
 * Per-agent update channel switcher (stage.md §2.5).
 *
 * Rendered as a 3-up segmented control so the user sees all options at a
 * glance and the dist-tag mapping is implicit in the label. Beta / Nightly
 * route the next Update through the install-at-version IPC; Stable uses the
 * default install pipeline.
 */
export function ChannelSelector({
  value,
  onChange,
  className,
}: ChannelSelectorProps): React.JSX.Element {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[10px] uppercase tracking-wider text-(--text-tertiary)">
        Update channel
      </span>
      <div
        role="radiogroup"
        aria-label="Update channel"
        className="inline-flex p-0.5 bg-(--bg-input) border border-(--border) rounded-(--radius) gap-0.5 self-start"
      >
        {OPTIONS.map((opt) => {
          const active = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              title={opt.description}
              onClick={() => onChange(opt.value)}
              className={cn(
                "text-[11px] px-2.5 py-1 rounded-sm cursor-pointer transition-colors duration-150",
                active
                  ? "bg-(--bg-card) text-(--text-primary) shadow-(--shadow-sm)"
                  : "text-(--text-secondary) hover:text-(--text-primary)",
              )}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
