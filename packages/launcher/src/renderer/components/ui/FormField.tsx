import * as React from "react"
import { cn } from "../../lib/utils"

interface FormFieldProps {
  label: string
  required?: boolean
  hint?: string
  error?: string
  children: React.ReactNode
  className?: string
}

function FormField({ label, required, hint, error, children, className }: FormFieldProps): React.JSX.Element {
  return (
    <div className={cn("flex flex-col gap-1.5 mb-3.5", className)}>
      <label className="text-[12px] font-medium text-(--text-primary)">
        {label}
        {required && <span className="ml-0.5 text-(--danger-text)"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="text-[11px] text-(--text-tertiary)">{hint}</p>}
      {error && <p className="text-[11px] text-(--danger-text)">{error}</p>}
    </div>
  )
}

export { FormField }
