import React from "react"
import AgentIcon from "../AgentIcon"
import type { CatalogEntry } from "../../types"

interface Props {
  catalog: CatalogEntry[]
  onOpen: (name: string) => void
}

/**
 * Featured banner — block-flow layout, no flex. Icon is absolutely positioned
 * to the right so the text flow can never collide with it.
 */
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
    <div
      style={{
        position: "relative",
        borderRadius: 12,
        padding: "28px 180px 28px 32px",
        background:
          "linear-gradient(135deg, #6366f1 0%, #4f46e5 50%, #7c3aed 100%)",
        boxShadow: "0 4px 20px rgba(99,102,241,0.25)",
        minHeight: 200,
        boxSizing: "border-box",
      }}
    >
      {/* Right: icon tile, absolutely positioned so it can't shrink the text */}
      <div
        style={{
          position: "absolute",
          top: 28,
          right: 28,
          width: 132,
          height: 132,
          borderRadius: 16,
          background: "rgba(255,255,255,0.18)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {hero ? (
          <AgentIcon type={hero.name} size={72} />
        ) : (
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.3)",
            }}
          />
        )}
      </div>

      {/* Left: stacked text + CTA in normal block flow */}
      <div
        style={{
          color: "rgba(255,255,255,0.85)",
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          marginBottom: 12,
        }}
      >
        FEATURED
      </div>

      <h2
        style={{
          color: "#ffffff",
          margin: 0,
          fontSize: 26,
          fontWeight: 800,
          letterSpacing: "-0.02em",
          lineHeight: 1.15,
        }}
      >
        {title}
      </h2>

      <p
        style={{
          color: "rgba(255,255,255,0.92)",
          margin: "10px 0 0",
          fontSize: 14,
          lineHeight: 1.55,
          maxWidth: 540,
        }}
      >
        {description}
      </p>

      <button
        type="button"
        onClick={() => {
          if (hero) onOpen(hero.name)
        }}
        disabled={!hero}
        style={{
          display: "inline-block",
          marginTop: 22,
          background: "#ffffff",
          color: "#4f46e5",
          border: "none",
          borderRadius: 6,
          padding: "10px 20px",
          fontSize: 13,
          fontWeight: 700,
          cursor: hero ? "pointer" : "not-allowed",
          opacity: hero ? 1 : 0.6,
          boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
        }}
      >
        {ctaLabel}
      </button>
    </div>
  )
}
