import * as React from "react"
import { useEffect } from "react"
import ReactDOM from "react-dom"
import { cn } from "../../lib/utils"

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  className?: string
  /** Panel layout: fixed header/footer with a scrollable body region. */
  layout?: "default" | "panel"
}

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
  layout = "default",
}: ModalProps): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, onClose])

  if (!open) return null

  const isPanel = layout === "panel"

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-1000 flex items-center justify-center bg-black/20 backdrop-blur-2xl animate-[fadeIn_0.15s_var(--ease)]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className={cn(
          "min-w-100 max-w-130 rounded-lg bg-(--bg-card) border border-(--border) shadow-lg",
          "animate-[modalIn_0.22s_var(--ease)]",
          isPanel
            ? "flex flex-col max-h-[min(80vh,720px)] overflow-hidden"
            : "max-h-[80vh] overflow-y-auto p-7",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && !isPanel && <ModalTitle>{title}</ModalTitle>}
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function ModalHeader({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={cn("shrink-0 px-7 pt-7 pb-4 border-b border-(--border)", className)}>
      {children}
    </div>
  )
}

export function ModalBody({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex-1 min-h-0 overflow-y-auto scrollbar-hide px-7 py-4 flex flex-col gap-4",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function ModalFooter({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "shrink-0 flex flex-col gap-3 px-7 py-4 border-t border-(--border) bg-(--bg-card)",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function ModalTitle({
  className,
  children,
  style,
}: {
  className?: string
  children: React.ReactNode
  style?: React.CSSProperties
}): React.JSX.Element {
  return (
    <h3
      className={cn(
        "text-[17px] font-bold mb-5 tracking-[-0.02em]",
        className,
      )}
      style={style}
    >
      {children}
    </h3>
  )
}

export function ModalActions({ className, children }: { className?: string; children: React.ReactNode }): React.JSX.Element {
  return <div className={cn("flex flex-row gap-2 mt-5", className)}>{children}</div>
}
