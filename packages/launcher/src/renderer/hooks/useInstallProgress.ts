import { useEffect } from 'react'
import { useInstallStore } from '../store/install'
import type { InstallProgressEvent } from '../types'

/**
 * Global IPC subscription that mirrors main process `install:progress` +
 * `install:output` events into the install store. Mount this once at the App
 * root — components read jobs out of the store. Matches the legacy renderer's
 * single-subscriber pattern so streaming output never gets dropped between
 * route changes.
 */
export function useInstallProgress(): void {
  useEffect(() => {
    const onProgress = (ev: InstallProgressEvent): void => {
      const state = useInstallStore.getState()
      if (!state.jobs[ev.agent] && ev.phase !== 'done' && ev.phase !== 'error') {
        state.startJob({ agent: ev.agent, verb: ev.verb, phase: ev.phase, detail: ev.detail })
      }
      state.updateJob(ev.agent, { phase: ev.phase, detail: ev.detail ?? '', error: ev.error })
    }
    const onOutput = (data: string): void => {
      const state = useInstallStore.getState()
      // Append to the most recently started active job. There's only ever one
      // install running at a time on the daemon side, but multiple terminal
      // jobs may linger in the store post-completion.
      const active = Object.values(state.jobs)
        .filter((j) => j.phase !== 'done' && j.phase !== 'error')
        .sort((a, b) => b.startedAt - a.startedAt)[0]
      if (active) state.appendLog(active.agent, data)
    }

    window.api.onInstallProgress(onProgress as unknown as (ev: unknown) => void)
    window.api.onInstallOutput(onOutput)
    return () => {
      window.api.removeInstallProgressListener()
      window.api.removeInstallOutputListener()
    }
  }, [])
}
