import React from "react"
import { Search } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cn } from "../lib/utils"

interface Props {
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Action buttons rendered on the right (before the search box). */
  actions?: React.ReactNode
  /** When true, shows the Cmd+K search input on the right. */
  showSearch?: boolean
  className?: string
}

export function TopBar({
  title,
  subtitle,
  actions,
  showSearch = false,
  className,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const triggerPalette = (): void => {
    const evt = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      ctrlKey: true,
    })
    document.dispatchEvent(evt)
  }

  return (
    <header
      className={cn(
        "shrink-0 flex items-center justify-between gap-4",
        "px-9 py-4 bg-(--bg-primary) border-b border-(--border)",
        className,
      )}
    >
      <div className="flex items-baseline gap-2 min-w-0">
        <h1 className="m-0 text-[18px] font-bold tracking-[-0.02em] text-(--text-primary) truncate">
          {title}
        </h1>
        {subtitle && (
          <span className="text-[13px] text-(--text-tertiary) truncate">
            {subtitle}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {actions}
        {showSearch && (
          <button
            type="button"
            onClick={triggerPalette}
            className={cn(
              "flex items-center gap-2 pl-3 pr-2 py-1.5 min-w-[260px]",
              "rounded-(--radius-sm) bg-(--bg-card) border border-(--border)",
              "hover:border-(--border-hover) transition-colors cursor-pointer text-left",
            )}
            title={t("ui.topBar.openCommandPalette")}
          >
            <Search className="w-3.5 h-3.5 text-(--text-tertiary)" />
            <span className="flex-1 text-[12px] text-(--text-tertiary)">
              {t("ui.topBar.searchPlaceholder")}
            </span>
            <kbd className="text-[10px] bg-(--bg-input) text-(--text-secondary) px-1.5 py-0.5 rounded-sm">
              ⌘K
            </kbd>
          </button>
        )}
      </div>
    </header>
  )
}
