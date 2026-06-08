import * as React from "react"
import { cn } from "../../lib/utils"

const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "flex w-full rounded-sm border border-transparent",
        "bg-(--bg-input) text-(--text-primary) px-[14px] py-[9px] text-[13px] outline-none",
        "transition-all duration-150",
        "focus:border-(--accent) focus:bg-(--bg-secondary) focus:shadow-[0_0_0_3px_var(--accent-bg)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
)
Select.displayName = "Select"

export { Select }
