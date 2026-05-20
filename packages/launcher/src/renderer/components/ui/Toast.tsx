import * as React from "react"
import { useEffect, useState } from "react"
import ReactDOM from "react-dom"
import { create } from "zustand"

// ─── internal store ────────────────────────────────────────────────────────
interface ToastItem {
  id: string
  message: string
  type: "success" | "error" | "warning" | "info"
  visible: boolean
}

const useToastStore = create<{
  toasts: ToastItem[]
  add: (t: ToastItem) => void
  dismiss: (id: string) => void
}>((set) => ({
  toasts: [],
  add: (t) => set((s) => ({ toasts: [...s.toasts, t] })),
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, visible: false } : t)) })),
}))

function addToast(message: string, type: ToastItem["type"]): void {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  useToastStore.getState().add({ id, message, type, visible: true })
  setTimeout(() => {
    useToastStore.getState().dismiss(id)
    setTimeout(
      () => useToastStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      300,
    )
  }, 4000)
}

// ─── public API ────────────────────────────────────────────────────────────
export const toast = {
  success: (msg: string) => addToast(msg, "success"),
  error:   (msg: string) => addToast(msg, "error"),
  warning: (msg: string) => addToast(msg, "warning"),
  info:    (msg: string) => addToast(msg, "info"),
}

// ─── per-type colors (bg / text / icon) ────────────────────────────────────
const typeStyle: Record<ToastItem["type"], { bg: string; text: string; icon: string }> = {
  success: { bg: "var(--success-bg)", text: "var(--success-text)", icon: "✓" },
  error:   { bg: "var(--danger-bg)",  text: "var(--danger-text)",  icon: "✕" },
  warning: { bg: "var(--warning-bg)", text: "var(--warning-text)", icon: "⚠" },
  info:    { bg: "var(--accent-bg)",  text: "var(--accent)",       icon: "ℹ" },
}

// ─── single toast card ─────────────────────────────────────────────────────
function ToastCard({ toast: t }: { toast: ToastItem }): React.JSX.Element {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { requestAnimationFrame(() => setMounted(true)) }, [])

  const { bg, text, icon } = typeStyle[t.type]
  const show = mounted && t.visible

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: 300,
        padding: "10px 14px",
        background: "var(--bg-card)",
        backgroundImage: `linear-gradient(${bg}, ${bg})`,
        border: `1px solid ${text}40`,
        borderRadius: "var(--radius-sm)",
        boxShadow: "var(--shadow-md)",
        color: text,
        transform: show ? "translateX(0)" : "translateX(calc(100% + 20px))",
        opacity: show ? 1 : 0,
        transition: "transform 0.25s var(--ease), opacity 0.25s var(--ease)",
        pointerEvents: "auto",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700, flexShrink: 0, lineHeight: 1 }}>
        {icon}
      </span>
      <span style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.4, flex: 1 }}>
        {t.message}
      </span>
    </div>
  )
}

// ─── container (top-right) ─────────────────────────────────────────────────
export function ToastContainer(): React.JSX.Element {
  const toasts = useToastStore((s) => s.toasts)
  return ReactDOM.createPortal(
    <div
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>,
    document.body,
  )
}
