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

// ─── per-type classes ──────────────────────────────────────────────────────
// `tint` is a flat-color gradient stacked on top of an opaque `--bg-card`
// base. The CSS variables (--success-bg, --danger-bg, etc.) are intentionally
// semi-transparent rgba() values (~8% alpha) — so we layer the opaque card
// color underneath to keep the toast itself fully opaque while still showing
// the tint.
const TYPE_CLASSES: Record<
  ToastItem["type"],
  { tint: string; text: string; border: string; icon: string }
> = {
  success: {
    tint: "bg-[linear-gradient(var(--success-bg),var(--success-bg))]",
    text: "text-(--success-text)",
    border: "border-(--success-text)/25",
    icon: "✓",
  },
  error: {
    tint: "bg-[linear-gradient(var(--danger-bg),var(--danger-bg))]",
    text: "text-(--danger-text)",
    border: "border-(--danger-text)/25",
    icon: "✕",
  },
  warning: {
    tint: "bg-[linear-gradient(var(--warning-bg),var(--warning-bg))]",
    text: "text-(--warning-text)",
    border: "border-(--warning-text)/25",
    icon: "⚠",
  },
  info: {
    tint: "bg-[linear-gradient(var(--accent-bg),var(--accent-bg))]",
    text: "text-(--accent)",
    border: "border-(--accent)/25",
    icon: "ℹ",
  },
}

// ─── single toast card ─────────────────────────────────────────────────────
function ToastCard({ toast: t }: { toast: ToastItem }): React.JSX.Element {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    requestAnimationFrame(() => setMounted(true))
  }, [])

  const { tint, text, border, icon } = TYPE_CLASSES[t.type]
  const show = mounted && t.visible

  return (
    <div
      className={[
        "pointer-events-auto flex items-center gap-2 w-75 px-3.5 py-2.5",
        "rounded-(--radius-sm) shadow-md border",
        "transition-[transform,opacity] duration-250 ease-(--ease)",
        "bg-(--bg-card)",
        tint,
        text,
        border,
        show ? "translate-x-0 opacity-100" : "translate-x-[calc(100%+20px)] opacity-0",
      ].join(" ")}
    >
      <span className="text-[13px] font-bold leading-none shrink-0">{icon}</span>
      <span className="text-[12px] font-medium leading-[1.4] flex-1">{t.message}</span>
    </div>
  )
}

// ─── container (top-right) ─────────────────────────────────────────────────
export function ToastContainer(): React.JSX.Element {
  const toasts = useToastStore((s) => s.toasts)
  return ReactDOM.createPortal(
    <div className="fixed top-5 right-5 z-9999 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>,
    document.body,
  )
}
