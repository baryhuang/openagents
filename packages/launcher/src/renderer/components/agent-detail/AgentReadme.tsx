import React from "react"
import { useTranslation } from "react-i18next"
import type { CatalogEntry } from "../../types"

const SECTION = "px-4.5 py-4 bg-(--bg-card) border border-(--border) rounded-(--radius) shadow-sm"
const SECTION_H4 = "text-xs font-semibold uppercase tracking-wider text-(--text-secondary) m-0 mb-2.5"

interface AgentReadmeProps {
  entry: CatalogEntry
}

/**
 * Overview / long description / quick-start card. Renders registry-provided
 * long_description as-is (preserving whitespace) — the registry never
 * delivers HTML so React's default escaping is sufficient.
 */
export function AgentReadme({ entry }: AgentReadmeProps): React.JSX.Element {
  const { t } = useTranslation()
  const body = entry.long_description || entry.description || t("agents.readme.noDescription")
  return (
    <div className={SECTION}>
      <h4 className={SECTION_H4}>{t("agents.readme.overview")}</h4>
      <p className="text-xs text-(--text-secondary) leading-[1.7] m-0 whitespace-pre-wrap">
        {body}
      </p>
    </div>
  )
}
