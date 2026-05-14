import * as React from "react"
import { cn } from "../../lib/utils"

/**
 * Card matches launcher-legacy `.card` 1:1:
 *   background, 1px legacy border, radius 12px, padding 18px 20px,
 *   shadow-sm with hover transition.
 * Pass `noPadding` to opt-out (useful when an inner element controls padding).
 */
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  noPadding?: boolean
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, noPadding, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "bg-[var(--bg-card)] text-[var(--text-primary)]",
        "border border-[color:var(--border)] rounded-[var(--radius)]",
        "shadow-[var(--shadow-sm)]",
        "transition-[box-shadow,border-color] duration-[180ms] ease-[var(--ease)]",
        "hover:shadow-[var(--shadow-md)] hover:border-[color:var(--border-hover)]",
        !noPadding && "px-5 py-[18px]",
        className,
      )}
      {...props}
    />
  ),
)
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("mb-3 flex flex-col gap-1.5", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-[13px] font-semibold text-[var(--text-primary)] m-0",
      className,
    )}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn(className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("mt-3 flex items-center", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardTitle, CardContent, CardFooter }
