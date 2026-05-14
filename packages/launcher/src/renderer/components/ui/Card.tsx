import * as React from "react"
import { cn } from "../../lib/utils"

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { noPadding?: boolean }>(
  ({ className, noPadding, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "bg-(--bg-card) border border-(--border) rounded-(--radius)",
        "shadow-(--shadow-sm) transition-[box-shadow,border-color] duration-180 ease-(--ease)",
        "hover:shadow-(--shadow-md) hover:border-(--border-hover)",
        !noPadding && "px-5 py-[18px]",
        className,
      )}
      {...props}
    />
  ),
)
Card.displayName = "Card"

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("mb-3 flex flex-col gap-1.5", className)} {...props} />
  ),
)
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-[13px] font-semibold text-(--text-primary) m-0", className)} {...props} />
  ),
)
CardTitle.displayName = "CardTitle"

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn(className)} {...props} />,
)
CardContent.displayName = "CardContent"

export { Card, CardHeader, CardTitle, CardContent }
