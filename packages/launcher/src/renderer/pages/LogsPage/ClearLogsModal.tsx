import { useState } from 'react';

import { Button, Modal } from '../../components';

interface ClearLogsModalProps {
  onClose: () => void;
  onConfirm: (start: string, end: string) => Promise<void>;
}

function defaultStart(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return toLocal(d);
}

function defaultEnd(): string {
  return toLocal(new Date());
}

function toLocal(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ClearLogsModal({ onClose, onConfirm }: ClearLogsModalProps): JSX.Element {
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(start, end);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Clear logs in range" onClose={onClose}>
      <div className="form-field">
        <label className="form-field__label">From</label>
        <input
          type="datetime-local"
          className="form-field__input"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
      </div>
      <div className="form-field">
        <label className="form-field__label">To</label>
        <input
          type="datetime-local"
          className="form-field__input"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
      </div>
      {err && <div className="form-field__hint" style={{ color: 'var(--danger-text)' }}>{err}</div>}
      <div className="modal__actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={confirm} loading={busy}>Delete in range</Button>
      </div>
    </Modal>
  );
}
