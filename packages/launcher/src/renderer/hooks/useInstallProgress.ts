import { useEffect } from 'react'
import { useInstallStore } from '../store/install'
import type { InstallProgressEvent } from '../types'

/** Subscribe once at app mount: dispatch install:progress + install:output into the store. */
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
      // Append to whichever job is currently active. We choose the most recent active job.
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
