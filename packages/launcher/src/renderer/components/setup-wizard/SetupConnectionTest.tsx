import React from "react"
import { Button } from "../ui/Button"
import { WizardStepShell } from "./WizardStepShell"

interface SetupConnectionTestProps {
  message: string
  ok: boolean
  onNext: () => void
  onBack: () => void
  section?: "all" | "body" | "footer"
}

/** Step 2 — confirm connection result, then advance to instance creation. */
export function SetupConnectionTest({
  message,
  ok,
  onNext,
  onBack,
  section = "all",
}: SetupConnectionTestProps): React.JSX.Element {
  const body = (
    <>
      <p className={`text-[13px] m-0 ${ok ? "test-success" : "test-error"}`}>
        {message}
      </p>
      <p className="hint m-0">
        {ok
          ? "Connection looks good. Pick a name for your first agent instance."
          : "You can go back and adjust the configuration, or skip the test."}
      </p>
    </>
  )
  const footer = (
    <div className="form-actions mt-0">
      <Button variant="primary" onClick={onNext}>
        Next: Create agent
      </Button>
      <Button onClick={onBack}>Back</Button>
    </div>
  )

  if (section === "body") return body
  if (section === "footer") return footer
  return <WizardStepShell body={body} footer={footer} />
}
