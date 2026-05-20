import React from "react"
import { Input } from "../ui/Input"
import { Button } from "../ui/Button"

interface SetupCreateInstanceProps {
  agentName: string
  setAgentName: (n: string) => void
  defaultName: string
  submitting: boolean
  onSubmit: () => void
  onCancel: () => void
}

/**
 * Step 3 — name and create the first agent instance. The runtime side
 * (window.api.addAgent) is unchanged from legacy so callers don't have to
 * change anything to honor the install_agents.json schema.
 */
export function SetupCreateInstance({
  agentName,
  setAgentName,
  defaultName,
  submitting,
  onSubmit,
  onCancel,
}: SetupCreateInstanceProps): React.JSX.Element {
  return (
    <>
      <div className="form-group">
        <label>Agent name</label>
        <Input
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          placeholder={defaultName}
        />
      </div>
      <p className="hint" style={{ margin: "-4px 0 12px" }}>
        Used as the local identifier — you can rename or remove it later from
        the Agents tab.
      </p>
      <div className="form-actions">
        <Button
          variant="primary"
          onClick={onSubmit}
          disabled={submitting || !agentName.trim()}
        >
          {submitting ? "Creating…" : "Create agent"}
        </Button>
        <Button onClick={onCancel}>Finish later</Button>
      </div>
    </>
  )
}
