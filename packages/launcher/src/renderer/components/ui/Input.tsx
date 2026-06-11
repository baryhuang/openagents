import * as React from "react"
import { cn } from "../../lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref} type={type}
      className={cn(
        "flex w-full rounded-sm border border-transparent",
        "bg-(--bg-input) text-(--text-primary) px-[14px] py-[9px] text-[13px] outline-none",
        "placeholder:text-(--text-tertiary) transition-all duration-150",
        "focus:border-(--accent) focus:bg-(--bg-secondary) focus:shadow-[0_0_0_3px_var(--accent-bg)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = "Input"

export { Input }
