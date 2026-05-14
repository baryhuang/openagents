import * as React from "react"
import { cn } from "../../lib/utils"

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

/**
 * Input mirrors launcher-legacy `.form-group input` 1:1:
 *   bg-input, transparent 1px border, radius-sm, padding 9px 14px,
 *   13px font, focused state shows accent ring + white bg.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex w-full rounded-sm border border-transparent",
          "bg-[var(--bg-input)] text-[var(--text-primary)]",
          "px-[14px] py-[9px] text-[13px] outline-none",
          "transition-all duration-150 ease-[var(--ease)]",
          "placeholder:text-[var(--text-tertiary)]",
          "focus:border-[var(--accent)] focus:bg-white focus:shadow-[0_0_0_3px_var(--accent-bg)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Input.displayName = "Input"

export { Input }
