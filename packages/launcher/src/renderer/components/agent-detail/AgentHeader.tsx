import React from "react"
import AgentIcon from "../AgentIcon"
import { Badge } from "../ui/Badge"
import type { CatalogEntry, InstalledAgentRecord } from "../../types"

interface AgentHeaderProps {
  entry: CatalogEntry
  installed: InstalledAgentRecord | null
  currentVersion: string | null
  latestVersion: string | null
  homepage?: string
  github?: string
  docs?: string
  installedAtLabel?: string | null
}

/**
 * Top-of-page presentation block: icon, title, description, status badges,
 * version info, external links. Pure display — install/uninstall actions
 * live in AgentInstallActions so this can be reused on smaller surfaces.
 */
export function AgentHeader({
  entry,
  installed,
  currentVersion,
  latestVersion,
  homepage,
  github,
  docs,
  installedAtLabel,
}: AgentHeaderProps): React.JSX.Element {
  const isInstalled = entry.installed
  const isManaged = entry.managed !== false
  const hasUpdate = !!(currentVersion && latestVersion && currentVersion !== latestVersion)

  const externals = [
    homepage && { label: homepage.replace(/^https?:\/\//, ""), url: homepage },
    github && { label: "GitHub", url: github },
    docs && { label: "Docs", url: docs },
  ].filter(Boolean) as Array<{ label: string; url: string }>

  return (
    <div className="flex items-start gap-4 pt-1 pb-3 border-b border-(--border)">
      <AgentIcon type={entry.name} size={56} />
      <div className="flex-1 min-w-0">
        <h2 className="text-xl font-bold tracking-tight m-0 mb-1 flex items-center gap-2">
          <span className="truncate">{entry.label || entry.name}</span>
          {entry.featured && (
            <span className="text-[11px] text-(--accent)" title="Featured">★</span>
          )}
        </h2>
        <p className="text-[13px] text-(--text-secondary) leading-snug m-0 mb-2">
          {entry.description || "No description available"}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {isInstalled ? (
            isManaged
              ? <Badge variant="success">Installed</Badge>
              : <Badge variant="info" title="Installed outside OpenAgents (system/global)">Global</Badge>
          ) : (
            <Badge variant="warning">Not installed</Badge>
          )}
          {hasUpdate && (
            <Badge variant="warning">Update v{latestVersion} available</Badge>
          )}
          {currentVersion && (
            <span className="text-[11px] text-(--text-tertiary)">
              v{currentVersion}
            </span>
          )}
          {installedAtLabel && (
            <span
              className="text-[11px] text-(--text-tertiary)"
              title="Installed at"
            >
              {installedAtLabel}
            </span>
          )}
          {(entry.tags || []).slice(0, 5).map((t) => (
            <span
              key={t}
              className="text-[10.5px] px-2 py-0.5 rounded-[10px] bg-(--bg-input) text-(--text-secondary)"
            >
              {t}
            </span>
          ))}
        </div>
        {externals.length > 0 && (
          <div className="mt-2 flex items-center gap-3 flex-wrap text-[11px]">
            {externals.map((e) => (
              <a
                key={e.url}
                href="#"
                onClick={(ev) => { ev.preventDefault(); window.api.openExternal(e.url) }}
              >
                {e.label} ↗
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
