import * as React from "react"
import type { CredentialSummary } from "../../types"

/**
 * Where this credential is referenced. Driven by the credential's
 * `usedByAgents` / `usedByConnections` fields plus the in-renderer
 * connections cross-reference.
 */
export function CredentialUsage({
  cred,
}: {
  cred: CredentialSummary
}): React.JSX.Element {
  const agents = cred.usedByAgents || []
  const conns = cred.usedByConnections || []
  const total = agents.length + conns.length
  if (total === 0) {
    return (
      <div className="text-[11px] text-(--text-tertiary)">
        Not used by any agent yet
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-(--text-tertiary)">
      <span>Used by:</span>
      {agents.map((a) => (
        <span
          key={`agent:${a}`}
          className="inline-flex items-center px-1.5 py-px rounded bg-(--bg-input) text-(--text-secondary)"
        >
          {a}
        </span>
      ))}
      {conns.map((c) => (
        <span
          key={`conn:${c}`}
          className="inline-flex items-center px-1.5 py-px rounded bg-(--accent-bg) text-(--text-link)"
        >
          conn:{c.slice(0, 6)}
        </span>
      ))}
    </div>
  )
}
