import React from "react"

interface AgentScreenshotsProps {
  screenshots: string[]
  demoUrl?: string | null
  altPrefix: string
}

/**
 * Horizontal screenshot gallery + optional demo video link. Lazy-loads images
 * so opening the detail page doesn't block on remote assets.
 */
export function AgentScreenshots({
  screenshots,
  demoUrl,
  altPrefix,
}: AgentScreenshotsProps): React.JSX.Element | null {
  if (screenshots.length === 0 && !demoUrl) return null
  return (
    <div className="flex flex-col gap-2.5">
      {screenshots.length > 0 && (
        <div className="flex gap-2.5 overflow-x-auto pb-1.5">
          {screenshots.map((src, i) => (
            <a
              key={`${src}-${i}`}
              href="#"
              onClick={(e) => { e.preventDefault(); window.api.openExternal(src) }}
              className="flex-none block border border-(--border) rounded-lg overflow-hidden bg-(--bg-input) transition-all duration-150 hover:border-(--accent) hover:-translate-y-px"
              title="Open full size"
            >
              <img
                src={src}
                alt={`${altPrefix} screenshot ${i + 1}`}
                loading="lazy"
                className="block h-35 w-auto max-w-65 object-cover"
              />
            </a>
          ))}
        </div>
      )}
      {demoUrl && (
        <a
          href="#"
          className="text-[12px]"
          onClick={(e) => { e.preventDefault(); window.api.openExternal(demoUrl) }}
        >
          ▶ Watch demo video ↗
        </a>
      )}
    </div>
  )
}
