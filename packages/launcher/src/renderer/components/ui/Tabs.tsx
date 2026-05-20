import * as React from "react"
import { cn } from "../../lib/utils"

// ─── context ───────────────────────────────────────────────────────────────
const TabsCtx = React.createContext<{ value: string; onChange: (v: string) => void } | null>(null)

function useTabs(): { value: string; onChange: (v: string) => void } {
  const ctx = React.useContext(TabsCtx)
  if (!ctx) throw new Error("Tabs: must be used inside <Tabs>")
  return ctx
}

// ─── Tabs (root) ───────────────────────────────────────────────────────────
interface TabsProps { value: string; onValueChange: (v: string) => void; children: React.ReactNode; className?: string }
function Tabs({ value, onValueChange, children, className }: TabsProps): React.JSX.Element {
  return (
    <TabsCtx.Provider value={{ value, onChange: onValueChange }}>
      <div className={cn(className)}>{children}</div>
    </TabsCtx.Provider>
  )
}

// ─── TabsList ──────────────────────────────────────────────────────────────
const TabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("inline-flex items-center gap-1 rounded-(--radius-sm) bg-(--bg-input) p-1", className)} {...props} />
  ),
)
TabsList.displayName = "TabsList"

// ─── TabsTrigger ───────────────────────────────────────────────────────────
interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { value: string }
const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, value, ...props }, ref) => {
    const { value: active, onChange } = useTabs()
    const isActive = active === value
    return (
      <button
        ref={ref} type="button" role="tab" aria-selected={isActive}
        data-state={isActive ? "active" : "inactive"}
        onClick={() => onChange(value)}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5",
          "text-[12px] font-medium text-(--text-secondary)",
          "transition-all duration-150 cursor-pointer select-none outline-none",
          "disabled:pointer-events-none disabled:opacity-50",
          isActive && "bg-(--bg-card) text-(--text-primary) shadow-sm",
          className,
        )}
        {...props}
      />
    )
  },
)
TabsTrigger.displayName = "TabsTrigger"

// ─── TabsContent ───────────────────────────────────────────────────────────
interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> { value: string }
const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, ...props }, ref) => {
    const { value: active } = useTabs()
    if (active !== value) return null
    return <div ref={ref} role="tabpanel" className={cn("mt-4 outline-none", className)} {...props} />
  },
)
TabsContent.displayName = "TabsContent"

export { Tabs, TabsList, TabsTrigger, TabsContent }
