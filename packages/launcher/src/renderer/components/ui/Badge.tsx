import * as React from "react"
import { cn } from "../../lib/utils"

export type BadgeVariant =
  | "default" | "success" | "warning" | "danger" | "info"
  | "success-sm" | "warning-sm" | "danger-sm" | "muted-sm"

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

const variantClass: Record<BadgeVariant, string> = {
  "default":    "bg-(--bg-input) text-(--text-secondary) text-[10px] font-semibold uppercase tracking-[0.03em] px-[10px] py-[3px] rounded-full",
  "success":    "bg-(--success-bg) text-(--success-text) text-[10px] font-semibold uppercase tracking-[0.03em] px-[10px] py-[3px] rounded-full",
  "warning":    "bg-(--warning-bg) text-(--warning-text) text-[10px] font-semibold uppercase tracking-[0.03em] px-[10px] py-[3px] rounded-full",
  "danger":     "bg-(--danger-bg) text-(--danger-text) text-[10px] font-semibold uppercase tracking-[0.03em] px-[10px] py-[3px] rounded-full",
  "info":       "bg-[#e0e7ff] text-[#3730a3] text-[10px] font-semibold uppercase tracking-[0.03em] px-[10px] py-[3px] rounded-full",
  "success-sm": "bg-(--success-bg) text-(--success-text) text-[10px] font-medium px-[6px] py-[2px] rounded",
  "warning-sm": "bg-(--warning-bg) text-(--warning-text) text-[10px] font-medium px-[6px] py-[2px] rounded",
  "danger-sm":  "bg-(--danger-bg) text-(--danger-text) text-[10px] font-medium px-[6px] py-[2px] rounded",
  "muted-sm":   "bg-[#f0f0f0] text-[#888] text-[10px] font-medium px-[6px] py-[2px] rounded",
}

function Badge({ className, variant = "default", ...props }: BadgeProps): React.JSX.Element {
  return (
    <span
      className={cn("inline-flex items-center leading-[1.4] whitespace-nowrap", variantClass[variant], className)}
      {...props}
    />
  )
}

export { Badge }
