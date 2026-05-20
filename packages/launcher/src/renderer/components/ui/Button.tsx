import * as React from "react"
import { cn } from "../../lib/utils"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "destructive" | "ghost" | "link"
  size?: "default" | "sm" | "lg" | "icon"
}

const variantClass: Record<NonNullable<ButtonProps["variant"]>, string> = {
  default:     "bg-(--bg-card) text-(--text-primary) border-(--border) shadow-(--shadow-sm) hover:enabled:border-(--border-hover) hover:enabled:shadow-(--shadow-md) hover:enabled:bg-(--bg-card-hover)",
  primary:     "bg-(--accent) text-(--accent-text) font-semibold border-transparent shadow-[0_1px_4px_rgba(88,86,214,0.2)] hover:enabled:bg-(--accent-hover) hover:enabled:shadow-[0_3px_10px_rgba(88,86,214,0.25)]",
  destructive: "bg-(--bg-card) text-(--danger-text) border-[rgba(255,59,48,0.2)] shadow-(--shadow-sm) hover:enabled:bg-(--danger-bg) hover:enabled:border-[rgba(255,59,48,0.35)]",
  ghost:       "bg-transparent border-transparent shadow-none hover:enabled:bg-(--bg-input)",
  link:        "border-transparent shadow-none text-(--accent) underline-offset-4 hover:enabled:underline px-0",
}

const sizeClass: Record<NonNullable<ButtonProps["size"]>, string> = {
  default: "px-4 py-[7px] text-[12px]",
  sm:      "px-3 py-[5px] text-[11px]",
  lg:      "px-5 py-[9px] text-[13px]",
  icon:    "h-8 w-8 p-0",
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap",
        "rounded-sm font-medium leading-[1.4] cursor-pointer select-none",
        "transition-all duration-150 border outline-none",
        "disabled:opacity-35 disabled:cursor-not-allowed",
        "active:enabled:scale-[0.97] active:enabled:shadow-none",
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...props}
    />
  ),
)
Button.displayName = "Button"

export { Button }
