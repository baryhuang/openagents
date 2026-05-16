import * as React from "react"
import { Eye, EyeOff } from "lucide-react"
import { cn } from "../../lib/utils"

export type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false)
    const Icon = visible ? EyeOff : Eye
    return (
      <div className="relative flex items-center w-full">
        <input
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn(
            "flex w-full rounded-sm border border-transparent",
            "bg-(--bg-input) text-(--text-primary) pl-[14px] pr-9 py-[9px] text-[13px] outline-none",
            "placeholder:text-(--text-tertiary) transition-all duration-150",
            "focus:border-(--accent) focus:bg-white focus:shadow-[0_0_0_3px_var(--accent-bg)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide value" : "Show value"}
          title={visible ? "Hide" : "Show"}
          className="absolute right-2 flex items-center justify-center h-6 w-6 text-(--text-tertiary) hover:text-(--text-primary) transition-colors cursor-pointer"
        >
          <Icon strokeWidth={2} className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  },
)
PasswordInput.displayName = "PasswordInput"

export { PasswordInput }
