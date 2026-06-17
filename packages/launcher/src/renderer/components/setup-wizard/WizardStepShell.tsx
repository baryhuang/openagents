import React from "react"
import { cn } from "../../lib/utils"

/**
 * Splits a wizard step into a scrollable body and a pinned footer so primary
 * actions stay visible without scrolling the whole modal.
 */
export function WizardStepShell({
  body,
  footer,
  bodyClassName,
  footerClassName,
}: {
  body: React.ReactNode
  footer: React.ReactNode
  bodyClassName?: string
  footerClassName?: string
}): React.JSX.Element {
  return (
    <>
      <div className={cn("flex flex-col gap-3", bodyClassName)}>{body}</div>
      <div className={cn("flex flex-col gap-3", footerClassName)}>{footer}</div>
    </>
  )
}
