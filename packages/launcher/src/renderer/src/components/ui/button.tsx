import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

/**
 * Buttons mirror launcher-legacy `.btn` styling 1:1.
 * Use `variant` to pick a visual style, `size` for density.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-sm text-[12px] font-medium leading-[1.4]",
    "transition-all duration-150 cursor-pointer select-none",
    "border outline-none",
    "disabled:opacity-35 disabled:cursor-not-allowed",
    "active:enabled:scale-[0.97] active:enabled:shadow-none",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "bg-[var(--bg-card)] text-[var(--text-primary)]",
          "border-[color:var(--border)]",
          "shadow-[var(--shadow-sm)]",
          "hover:enabled:border-[color:var(--border-hover)]",
          "hover:enabled:shadow-[var(--shadow-md)]",
          "hover:enabled:bg-[var(--bg-card-hover)]",
        ].join(" "),
        primary: [
          "bg-[var(--accent)] text-[var(--accent-text)] font-semibold",
          "border-transparent",
          "shadow-[0_1px_4px_rgba(88,86,214,0.2)]",
          "hover:enabled:bg-[var(--accent-hover)]",
          "hover:enabled:shadow-[0_3px_10px_rgba(88,86,214,0.25)]",
        ].join(" "),
        destructive: [
          "bg-[var(--bg-card)] text-[var(--danger-text)]",
          "border-[rgba(255,59,48,0.2)]",
          "shadow-[var(--shadow-sm)]",
          "hover:enabled:bg-[var(--danger-bg)]",
          "hover:enabled:border-[rgba(255,59,48,0.35)]",
        ].join(" "),
        ghost:
          "bg-transparent border-transparent shadow-none hover:enabled:bg-[var(--bg-input)]",
        link: "border-transparent shadow-none text-[var(--accent)] underline-offset-4 hover:enabled:underline px-0",
      },
      size: {
        default: "px-4 py-[7px] text-[12px]",
        sm: "px-3 py-[5px] text-[11px]",
        lg: "px-5 py-[9px] text-[13px]",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
