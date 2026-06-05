import React from "react"
import AgentIcon from "../AgentIcon"
import type { CatalogEntry } from "../../types"

interface Props {
  catalog: CatalogEntry[]
  onOpen: (name: string) => void
}

export function FeaturedBanner({ catalog, onOpen }: Props): React.JSX.Element {
  const hero =
    catalog.find((c) => c.featured && !c.installed) ||
    catalog.find((c) => c.featured) ||
    catalog[0] ||
    null

  const title = hero?.label || hero?.name || "Discover AI agents"
  const description =
    hero?.description ||
    hero?.long_description ||
    "Browse, install, and update AI coding agents from the OpenAgents catalog."
  const ctaLabel = hero
    ? hero.installed
      ? "Open"
      : "Install Now"
    : "Browse all"

  return (
    <div className="relative box-border rounded-xl pl-8 pr-45 py-7 shadow-[0_4px_20px_rgba(99,102,241,0.25)] bg-[linear-gradient(135deg,#6366f1_0%,#4f46e5_50%,#7c3aed_100%)]">
      <div className="absolute top-7 right-7 w-33 h-33 rounded-2xl bg-white/15 flex items-center justify-center">
        {hero ? (
          <AgentIcon type={hero.name} size={72} />
        ) : (
          <div className="w-14 h-14 rounded-full bg-white/30" />
        )}
      </div>

      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/85 mb-3">
        FEATURED
      </div>

      <h2 className="m-0 text-[26px] font-extrabold leading-[1.15] tracking-[-0.02em] text-white">
        {title}
      </h2>

      <p className="mt-2.5 mb-0 max-w-135 text-[14px] leading-[1.55] text-white/90">
        {description}
      </p>

      <button
        type="button"
        onClick={() => {
          if (hero) onOpen(hero.name)
        }}
        disabled={!hero}
        className="inline-block mt-5.5 px-5 py-2.5 rounded-md bg-white text-[#4f46e5] text-[13px] font-bold border-0 shadow-[0_2px_6px_rgba(0,0,0,0.15)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
      >
        {ctaLabel}
      </button>
    </div>
  )
}
