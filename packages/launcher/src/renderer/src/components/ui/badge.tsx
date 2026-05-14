import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

/**
 * Badge mirrors launcher-legacy `.badge` / `.badge-*` 1:1:
 * - default: 10px / 600 / uppercase, 3px 10px padding, 20px radius
 * - `*-sm` variants: 10px / 500, 2px 6px padding, 4px radius (used inline)
 */
const badgeVariants = cva(
  "inline-flex items-center leading-[1.4] whitespace-nowrap",
  {
    variants: {
      variant: {
        // Pill badges (used on Install / catalog rows)
        success:
          "bg-[var(--success-bg)] text-[var(--success-text)] text-[10px] font-semibold uppercase tracking-[0.03em] px-[10px] py-[3px] rounded-full",
        warning:
          "bg-[var(--warning-bg)] text-[var(--warning-text)] text-[10px] font-semibold uppercase tracking-[0.03em] px-[10px] py-[3px] rounded-full",
        danger:
          "bg-[var(--danger-bg)] text-[var(--danger-text)] text-[10px] font-semibold uppercase tracking-[0.03em] px-[10px] py-[3px] rounded-full",
        info: "bg-[#e0e7ff] text-[#3730a3] text-[10px] font-semibold uppercase tracking-[0.03em] px-[10px] py-[3px] rounded-full",
        installed:
          "bg-[var(--success-bg)] text-[var(--success-text)] text-[10px] font-semibold uppercase tracking-[0.03em] px-[10px] py-[3px] rounded-full",
        "not-installed":
          "bg-[var(--warning-bg)] text-[var(--warning-text)] text-[10px] font-semibold uppercase tracking-[0.03em] px-[10px] py-[3px] rounded-full",
        global:
          "bg-[#e0e7ff] text-[#3730a3] text-[10px] font-semibold uppercase tracking-[0.03em] px-[10px] py-[3px] rounded-full",
        // Square small badges (used on Dashboard cards)
        "success-sm":
          "bg-[var(--success-bg)] text-[var(--success-text)] text-[10px] font-medium px-[6px] py-[2px] rounded",
        "warning-sm":
          "bg-[var(--warning-bg)] text-[var(--warning-text)] text-[10px] font-medium px-[6px] py-[2px] rounded",
        "danger-sm":
          "bg-[var(--danger-bg)] text-[var(--danger-text)] text-[10px] font-medium px-[6px] py-[2px] rounded",
        "muted-sm":
          "bg-[#f0f0f0] text-[#888] text-[10px] font-medium px-[6px] py-[2px] rounded",
      },
    },
    defaultVariants: {
      variant: "success",
    },
  },
)

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({
  className,
  variant,
  ...props
}: BadgeProps): React.JSX.Element {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
