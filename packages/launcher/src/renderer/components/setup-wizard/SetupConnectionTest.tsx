import React from "react"
import { Button } from "../ui/Button"

interface SetupConnectionTestProps {
  message: string
  ok: boolean
  onNext: () => void
  onBack: () => void
}

/** Step 2 — confirm connection result, then advance to instance creation. */
export function SetupConnectionTest({
  message,
  ok,
  onNext,
  onBack,
}: SetupConnectionTestProps): React.JSX.Element {
  return (
    <>
      <p
        className={`text-[13px] mt-1 ${ok ? "test-success" : "test-error"}`}
      >
        {message}
      </p>
      <p className="hint mb-3">
        {ok
          ? "Connection looks good. Pick a name for your first agent instance."
          : "You can go back and adjust the configuration, or skip the test."}
      </p>
      <div className="form-actions">
        <Button variant="primary" onClick={onNext}>
          Next: Create agent
        </Button>
        <Button onClick={onBack}>Back</Button>
      </div>
    </>
  )
}
