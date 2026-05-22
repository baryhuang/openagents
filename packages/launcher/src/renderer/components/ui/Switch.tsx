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
      className={cn(
        "relative inline-flex items-center shrink-0 outline-none border-none p-0 cursor-pointer",
        "w-11 h-6 rounded-full transition-colors duration-200 ease-(--ease)",
        checked ? "bg-(--accent)" : "bg-(--bg-input)",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      <span
        className={cn(
          "absolute top-0.75 w-4.5 h-4.5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-[left] duration-200 ease-(--ease)",
          checked ? "left-5.75" : "left-0.75",
        )}
      />
    </button>
  ),
)
Switch.displayName = "Switch"

export { Switch }
