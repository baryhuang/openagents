import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { useUiStore } from '../../store/uiStore';

import './Toast.css';

export function ToastHost(): JSX.Element | null {
  const toasts = useUiStore((s) => s.toasts);
  const removeToast = useUiStore((s) => s.removeToast);

  useEffect(() => {
    if (toasts.length === 0) return undefined;
    const now = Date.now();
    const nextExpiry = Math.min(...toasts.map((t) => t.expiresAt - now));
    const timer = setTimeout(() => {
      const expired = toasts.filter((t) => t.expiresAt <= Date.now());
      for (const t of expired) removeToast(t.id);
    }, Math.max(nextExpiry, 50));
    return () => clearTimeout(timer);
  }, [toasts, removeToast]);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`}>
          {toast.text}
        </div>
      ))}
    </div>,
    document.body,
  );
}
