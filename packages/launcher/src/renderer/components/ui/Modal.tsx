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
}

export function Modal({ open, onClose, title, children, className }: ModalProps): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, onClose])

  if (!open) return null

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-1000 flex items-center justify-center bg-black/20 backdrop-blur-2xl animate-[fadeIn_0.15s_var(--ease)]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className={cn(
          "min-w-100 max-w-130 max-h-[80vh] overflow-y-auto p-7",
          "rounded-lg bg-(--bg-card) border border-(--border) shadow-lg",
          "animate-[modalIn_0.22s_var(--ease)]",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <ModalTitle>{title}</ModalTitle>}
        {children}
      </div>
    </div>,
    document.body,
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
