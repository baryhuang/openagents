import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { useUiStore } from '../../store/uiStore';

import './Modal.css';

interface ModalProps {
  title?: string;
  onClose?: () => void;
  width?: number | string;
  children: React.ReactNode;
}

export function Modal({ title, onClose, width = 480, children }: ModalProps): JSX.Element | null {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const target = document.body;
  if (!target) return null;

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: typeof width === 'number' ? `${width}px` : width }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <div className="modal__title">{title}</div>}
        <div className="modal__body">{children}</div>
      </div>
    </div>,
    target,
  );
}

/** Renders the currently-open modal stored in `useUiStore`. */
export function ModalHost(): JSX.Element | null {
  const modal = useUiStore((s) => s.modal);
  return modal as JSX.Element | null;
}
