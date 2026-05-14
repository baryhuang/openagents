import { cn } from "../../lib/utils"

/**
 * Skeleton uses the legacy shimmer (`.skeleton-shimmer`) with rounded ends,
 * matching the look from launcher-legacy `.skeleton-line`.
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn("rounded-full skeleton-shimmer h-2.5", className)}
      {...props}
    />
  )
}

export { Skeleton }
