import * as React from "react"
import { cn } from "../../lib/utils"

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  plain?: boolean
}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, plain, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "block leading-none",
        !plain && "text-[11px] font-semibold text-(--text-secondary) uppercase tracking-[0.04em]",
        className,
      )}
      {...props}
    />
  ),
)
Label.displayName = "Label"

export { Label }
