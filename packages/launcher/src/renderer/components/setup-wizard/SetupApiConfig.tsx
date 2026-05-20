import React from "react"
import { Input } from "../ui/Input"
import { PasswordInput } from "../ui/PasswordInput"
import { Button } from "../ui/Button"
import type { EnvField } from "../../types"

interface SetupApiConfigProps {
  fields: EnvField[]
  values: Record<string, string>
  onChange: (next: Record<string, string>) => void
  testing: boolean
  errorMessage?: string | null
  onSubmit: () => void
  onSkip: () => void
}

/**
 * Step 1 of the post-install wizard — collect API keys / endpoint / token
 * declared by the agent's env_config. Password fields use PasswordInput so
 * secrets never appear plain in the DOM (per stage.md §2.2 security note).
 */
export function SetupApiConfig({
  fields,
  values,
  onChange,
  testing,
  errorMessage,
  onSubmit,
  onSkip,
}: SetupApiConfigProps): React.JSX.Element {
  if (fields.length === 0) {
    return (
      <>
        <p className="hint" style={{ margin: "8px 0 16px" }}>
          This agent has no API key requirements. You can continue and create
          your first instance.
        </p>
        <div className="form-actions">
          <Button variant="primary" onClick={onSubmit}>Continue</Button>
          <Button onClick={onSkip}>Skip</Button>
        </div>
      </>
    )
  }

  return (
    <>
      <p className="hint" style={{ margin: "4px 0 12px" }}>
        Saved locally to <code>~/.openagents/env/</code>. Secrets are never
        printed to logs.
      </p>
      {fields.map((f) => {
        const FieldInput = f.password ? PasswordInput : Input
        return (
          <div className="form-group" key={f.name}>
            <label>
              {f.description || f.name}
              {f.required && <span className="required"> *</span>}
            </label>
            <FieldInput
              value={values[f.name] ?? f.default ?? ""}
              onChange={(e) => onChange({ ...values, [f.name]: e.target.value })}
              placeholder={f.placeholder || `Enter ${f.name}…`}
            />
          </div>
        )
      })}
      {errorMessage && (
        <p className="test-error" style={{ fontSize: 12, margin: "4px 0 12px" }}>
          {errorMessage}
        </p>
      )}
      <div className="form-actions">
        <Button variant="primary" onClick={onSubmit} disabled={testing}>
          {testing ? "Testing…" : "Save & test connection"}
        </Button>
        <Button onClick={onSkip}>Skip</Button>
      </div>
    </>
  )
}
