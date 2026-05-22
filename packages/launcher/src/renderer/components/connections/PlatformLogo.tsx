import * as React from "react"
import { cn } from "../../lib/utils"
import type { PlatformDef } from "./platforms"

export function PlatformLogo({
  platform,
  size = 36,
  className,
}: {
  platform: PlatformDef
  size?: number
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-md shrink-0 text-white font-bold",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: platform.tint,
        fontSize: Math.round(size * 0.5),
        letterSpacing: "-0.02em",
      }}
    >
      {platform.glyph}
    </div>
  )
}
