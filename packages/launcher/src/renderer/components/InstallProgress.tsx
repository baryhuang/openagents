import React from "react"
import { cn } from "../lib/utils"
import type { InstallPhase } from "../types"
import type { InstallJob } from "../store/install"

const PHASES: Array<{ key: InstallPhase; label: string }> = [
  { key: "downloading", label: "Download" },
  { key: "installing", label: "Install" },
  { key: "verifying", label: "Verify" },
  { key: "done", label: "Done" },
]

function phaseIndex(phase: InstallPhase): number {
  switch (phase) {
    case "preparing": return 0
    case "downloading": return 0
    case "installing": return 1
    case "verifying": return 2
    case "done": return 3
    case "error": return -1
    default: return -1
  }
}

interface PhaseBarProps {
  phase: InstallPhase
  detail?: string
  errored?: boolean
}

export function PhaseBar({ phase, detail, errored }: PhaseBarProps): React.JSX.Element {
  const current = phaseIndex(phase)
  return (
    <div className="phase-bar">
      {PHASES.map((p, i) => {
        const isActive = !errored && i === current
        const isDone = !errored && i < current
        const isError = errored && i === Math.max(current, 0)
        return (
          <div
            key={p.key}
            className={cn(
              "phase-step",
              isActive && "active",
              isDone && "done",
              isError && "error",
            )}
          >
            <div className="phase-step-label">{p.label}</div>
            <div className="phase-step-detail">{isActive ? detail || "…" : isDone ? "✓" : isError ? "Failed" : ""}</div>
          </div>
        )
      })}
    </div>
  )
}

export function InstallMiniBanner({ job, onOpen }: { job: InstallJob; onOpen: () => void }): React.JSX.Element {
  const idx = phaseIndex(job.phase)
  const pct = job.phase === "done" ? 100
    : job.phase === "error" ? 100
    : Math.max(10, ((idx + 1) / PHASES.length) * 100 - 10)
  const errored = job.phase === "error"
  return (
    <button
      type="button"
      onClick={onOpen}
      className="install-mini"
      style={{ border: 0, textAlign: "left", cursor: "pointer" }}
      title="Click to view full log"
    >
      <div className="install-mini-title">
        <span>
          {job.verb === "uninstall" ? "Uninstalling" : job.verb === "rollback" ? "Rolling back" : job.verb === "update" ? "Updating" : "Installing"} {job.agent}
        </span>
      </div>
      <div className="install-mini-bar">
        <div className="install-mini-fill" style={{ width: `${pct}%`, background: errored ? "var(--danger)" : undefined }} />
      </div>
      <div className="install-mini-detail">{errored ? job.error || "Failed" : job.detail || job.phase}</div>
    </button>
  )
}
