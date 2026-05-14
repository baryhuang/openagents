import * as React from "react"
import { cn } from "../../lib/utils"

export interface SwitchProps {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  id?: string
  disabled?: boolean
  className?: string
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, id, disabled, className }, ref) => (
    <button
      ref={ref} id={id} type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => !disabled && onCheckedChange(!checked)}
      className={cn("relative inline-flex items-center shrink-0 outline-none border-none p-0 cursor-pointer", disabled && "opacity-50 cursor-not-allowed", className)}
      style={{ width: 44, height: 24, borderRadius: 999, background: checked ? "var(--accent)" : "var(--bg-input)", transition: "background 0.18s var(--ease)" }}
    >
      <span style={{ position: "absolute", top: 3, left: checked ? 23 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.18s var(--ease)" }} />
    </button>
  ),
)
Switch.displayName = "Switch"

export { Switch }
