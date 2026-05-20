import { useCallback } from 'react'
import { toast } from '../components/ui/Toast'
import { useUiStore } from '../store/ui'

export type ToastType = 'info' | 'success' | 'error' | 'warning'

export function showGlobalToast(message: string, type: ToastType = 'info'): void {
  fireToast(message, type)
  useUiStore.getState().addActivity(message)
}

function fireToast(message: string, type: ToastType): void {
  if (type === 'success') toast.success(message)
  else if (type === 'error') toast.error(message)
  else if (type === 'warning') toast.warning(message)
  else toast.info(message)
}

export function useToasts(): { showToast: (message: string, type?: ToastType) => void } {
  const addActivity = useUiStore((s) => s.addActivity)

  const showToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      fireToast(message, type)
      addActivity(message)
    },
    [addActivity],
  )

  return { showToast }
}
