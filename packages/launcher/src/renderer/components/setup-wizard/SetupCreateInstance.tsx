import React from "react"
import { Input } from "../ui/Input"
import { Button } from "../ui/Button"
import { WizardStepShell } from "./WizardStepShell"

interface SetupCreateInstanceProps {
  agentName: string
  setAgentName: (n: string) => void
  defaultName: string
  submitting: boolean
  onSubmit: () => void
  onCancel: () => void
  section?: "all" | "body" | "footer"
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
  section = "all",
}: SetupCreateInstanceProps): React.JSX.Element {
  const body = (
    <>
      <div className="form-group mb-0">
        <label>Agent name</label>
        <Input
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          placeholder={defaultName}
        />
      </div>
      <p className="hint m-0">
        Used as the local identifier — you can rename or remove it later from
        the Agents tab.
      </p>
    </>
  )
  const footer = (
    <div className="form-actions mt-0">
      <Button
        variant="primary"
        onClick={onSubmit}
        disabled={submitting || !agentName.trim()}
      >
        {submitting ? "Creating…" : "Create agent"}
      </Button>
      <Button onClick={onCancel}>Finish later</Button>
    </div>
  )

  if (section === "body") return body
  if (section === "footer") return footer
  return <WizardStepShell body={body} footer={footer} />
}
