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
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.2)",
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, animation: "fadeIn 0.15s var(--ease)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className={cn(className)}
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: 28, minWidth: 400, maxWidth: 520,
          maxHeight: "80vh", overflowY: "auto",
          boxShadow: "var(--shadow-lg)",
          animation: "modalIn 0.22s var(--ease)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <ModalTitle>{title}</ModalTitle>}
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function ModalTitle({ className, children, style }: { className?: string; children: React.ReactNode; style?: React.CSSProperties }): React.JSX.Element {
  return (
    <h3 className={cn(className)} style={{ fontSize: 17, fontWeight: 700, marginBottom: 20, letterSpacing: "-0.02em", ...style }}>
      {children}
    </h3>
  )
}

export function ModalActions({ className, children }: { className?: string; children: React.ReactNode }): React.JSX.Element {
  return <div className={cn("flex flex-row gap-2 mt-5", className)}>{children}</div>
}
