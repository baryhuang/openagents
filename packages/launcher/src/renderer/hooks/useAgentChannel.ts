import { useCallback, useEffect, useState } from "react"

export type UpdateChannel = "stable" | "beta" | "nightly"

const KEY = (agent: string): string => `installChannel:${agent}`

/**
 * Per-agent update channel selection (stage.md §2.5 — Stable / Beta /
 * Nightly).
 *
 * Stored via the main process settings store so the choice survives
 * launcher restarts and is visible to the install IPC. `stable` is the
 * default — the renderer treats unset / unknown values as stable so a
 * misconfigured store can never accidentally upgrade users to a pre-release
 * channel without their say-so.
 *
 * Renderer-side mapping to npm dist-tags / version specs is done by
 * `dispatchInstallForChannel` in AgentDetail.
 */
export function useAgentChannel(
  agentName: string,
): {
  channel: UpdateChannel
  setChannel: (next: UpdateChannel) => void
  loading: boolean
} {
  const [channel, setChannelState] = useState<UpdateChannel>("stable")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api
      .getSetting(KEY(agentName))
      .then((v) => {
        if (cancelled) return
        const valid: UpdateChannel[] = ["stable", "beta", "nightly"]
        if (typeof v === "string" && (valid as string[]).includes(v)) {
          setChannelState(v as UpdateChannel)
        } else {
          setChannelState("stable")
        }
      })
      .catch(() => {
        if (!cancelled) setChannelState("stable")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [agentName])

  const setChannel = useCallback(
    (next: UpdateChannel) => {
      setChannelState(next)
      window.api.setSetting(KEY(agentName), next).catch(() => {
        // non-fatal — local state still reflects the user's choice for this
        // session, and the next read will fall back to "stable" if the
        // write actually failed.
      })
    },
    [agentName],
  )

  return { channel, setChannel, loading }
}

/**
 * Resolve a channel to the npm dist-tag / version spec passed to
 * `npm install pkg@<tag>`. `stable` is treated specially — the regular
 * `installAgentTypeStreaming` already pulls from the `latest` tag, so the
 * caller can skip the version-specific IPC and use the normal install path.
 */
export function channelToDistTag(channel: UpdateChannel): string | null {
  switch (channel) {
    case "beta":
      return "beta"
    case "nightly":
      return "nightly"
    case "stable":
    default:
      return null
  }
}
