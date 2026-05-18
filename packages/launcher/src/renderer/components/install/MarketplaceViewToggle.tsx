import React from "react"
import { cn } from "../../lib/utils"
import type { MarketplaceView } from "../../hooks/useMarketplacePrefs"

interface MarketplaceViewToggleProps {
  value: MarketplaceView
  onChange: (next: MarketplaceView) => void
}

/** Grid / list toggle. Preference is persisted via useMarketplacePrefs. */
export function MarketplaceViewToggle({
  value,
  onChange,
}: MarketplaceViewToggleProps): React.JSX.Element {
  return (
    <div className="flex rounded-sm overflow-hidden border border-(--border)">
      {([
        { key: "grid", label: "Grid", icon: "▦" },
        { key: "list", label: "List", icon: "≡" },
      ] as const).map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={cn(
            "px-2.5 py-1.5 text-[11px] cursor-pointer transition-colors flex items-center gap-1",
            value === opt.key
              ? "bg-(--accent) text-white"
              : "bg-(--bg-card) text-(--text-secondary) hover:text-(--text-primary)",
          )}
          title={`${opt.label} view`}
          aria-pressed={value === opt.key}
        >
          <span aria-hidden="true">{opt.icon}</span>
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  )
}
