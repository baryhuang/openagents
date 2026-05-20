import * as React from "react"
import { cn } from "../../lib/utils"

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("skeleton-shimmer rounded-full h-2.5", className)} {...props} />
}

export { Skeleton }
