import React from "react"
import type { MarketplaceSort as SortKey } from "../../hooks/useMarketplacePrefs"

interface MarketplaceSortProps {
  value: SortKey
  onChange: (next: SortKey) => void
}

const OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "featured", label: "Featured" },
  { key: "popular", label: "Popular" },
  { key: "newest", label: "Newest" },
  { key: "name", label: "Name (A–Z)" },
]

/** Sort dropdown — stage.md §2.1 keys: featured / newest / popular / name. */
export function MarketplaceSort({
  value,
  onChange,
}: MarketplaceSortProps): React.JSX.Element {
  return (
    <select
      className="bg-(--bg-input) text-(--text-primary) px-3 py-1.75 text-xs rounded-sm border-0 outline-none cursor-pointer"
      value={value}
      onChange={(e) => onChange(e.target.value as SortKey)}
      aria-label="Sort"
    >
      {OPTIONS.map((o) => (
        <option key={o.key} value={o.key}>Sort: {o.label}</option>
      ))}
    </select>
  )
}
