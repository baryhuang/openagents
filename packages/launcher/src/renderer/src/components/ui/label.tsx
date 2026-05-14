import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cn } from "../../lib/utils"

/**
 * Default Label matches the legacy `.form-group label` style:
 * 11px, semibold, uppercase, letter-spaced.
 *
 * Pass `plain` to opt out for places (like Settings → General) that
 * use a friendlier description-style label.
 */
interface LabelProps
  extends React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> {
  plain?: boolean
}

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  LabelProps
>(({ className, plain, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "block leading-none",
      "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      !plain &&
        "text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-[0.04em] mb-1.5",
      className,
    )}
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
