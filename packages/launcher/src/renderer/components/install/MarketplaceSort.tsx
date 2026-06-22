import React from "react"
import { useTranslation } from "react-i18next"
import type { MarketplaceSort as SortKey } from "../../hooks/useMarketplacePrefs"

interface MarketplaceSortProps {
  value: SortKey
  onChange: (next: SortKey) => void
}

// Keep only the ids at module level; labels are translated at render time.
const OPTION_KEYS: SortKey[] = ["featured", "popular", "newest", "name"]

/** Sort dropdown — stage.md §2.1 keys: featured / newest / popular / name. */
export function MarketplaceSort({
  value,
  onChange,
}: MarketplaceSortProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <select
      className="bg-(--bg-input) text-(--text-primary) px-3 py-1.75 text-xs rounded-sm border-0 outline-none cursor-pointer"
      value={value}
      onChange={(e) => onChange(e.target.value as SortKey)}
      aria-label={t("install.sort.ariaLabel")}
    >
      {OPTION_KEYS.map((key) => (
        <option key={key} value={key}>
          {t("install.sort.prefix", { label: t(`install.sort.${key}`) })}
        </option>
      ))}
    </select>
  )
}
