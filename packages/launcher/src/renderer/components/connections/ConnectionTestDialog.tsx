import React, { useEffect, useState } from "react"
import { Modal, ModalActions } from "../ui/Modal"
import { Button } from "../ui/Button"
import { PlatformLogo } from "./PlatformLogo"
import { ConnectionStatusBadge } from "./ConnectionStatusBadge"
import { getPlatform } from "./platforms"
import type {
  ConnectionRecord,
  ConnectionStatus,
  ConnectionTestResult,
} from "../../types"

/**
 * Runs a probe against the saved credential and surfaces the structured
 * result inline (status badge + account + detail). stage.md §4.2 —
 * "Test Connection".
 */
export function ConnectionTestDialog({
  open,
  connection,
  onClose,
  onAfterRun,
}: {
  open: boolean
  connection: ConnectionRecord | null
  onClose: () => void
  onAfterRun?: () => void
}): React.JSX.Element {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ConnectionTestResult | null>(null)
  const platform = connection ? getPlatform(connection.platform) : undefined

  useEffect(() => {
    if (open) setResult(null)
  }, [open, connection?.id])

  const runTest = async (): Promise<void> => {
    if (!connection) return
    setRunning(true)
    try {
      const r = await window.api.testConnection(connection.id)
      setResult(r)
    } catch (e) {
      setResult({ ok: false, status: "error", detail: (e as Error).message })
    } finally {
      setRunning(false)
      onAfterRun?.()
    }
  }

  // Auto-run on open for a smoother UX.
  useEffect(() => {
    if (open && connection && !result && !running) {
      void runTest()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connection?.id])

  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex flex-col items-center py-2">
        {platform && <PlatformLogo platform={platform} size={44} />}
        <h3 className="text-[17px] font-bold tracking-[-0.02em] mt-3 mb-1 text-center">
          Test {platform?.label || connection?.platform}
        </h3>
        <p className="text-[12px] text-(--text-tertiary) text-center m-0">
          Pings the platform's API with the saved credential.
        </p>

        <div className="w-full mt-5 mb-2 flex flex-col items-center gap-2">
          {running && (
            <div className="text-[12px] text-(--text-secondary)">Running probe…</div>
          )}
          {result && (
            <>
              <ConnectionStatusBadge
                status={(result.status as ConnectionStatus) || "error"}
              />
              {result.account && (
                <div className="text-[12px] text-(--text-secondary)">
                  Account: <strong>{result.account}</strong>
                </div>
              )}
              {result.detail && (
                <div className="text-[11px] text-(--text-tertiary) text-center max-w-[360px] break-words">
                  {result.detail}
                </div>
              )}
            </>
          )}
        </div>

        <ModalActions>
          <Button onClick={runTest} disabled={running}>
            {running ? "Testing..." : "Run again"}
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </ModalActions>
      </div>
    </Modal>
  )
}
