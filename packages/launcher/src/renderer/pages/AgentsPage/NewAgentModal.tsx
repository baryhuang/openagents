import { useEffect, useState } from 'react';

import type { CatalogEntry } from '@shared/models';

import { AgentIcon, Button, Modal } from '../../components';
import { ipc } from '../../lib/api';

interface NewAgentModalProps {
  onClose: () => void;
  onCreate: (name: string, type: string) => Promise<void>;
}

export function NewAgentModal({ onClose, onCreate }: NewAgentModalProps): JSX.Element {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void ipc()
      .getCatalog()
      .then((c) => {
        const installed = c.filter((e) => e.installed);
        setEntries(installed);
        if (installed.length > 0) setType(installed[0].name);
      })
      .catch(() => undefined);
  }, []);

  const handleSubmit = async (): Promise<void> => {
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!type) {
      setError('Pick an agent type');
      return;
    }
    setBusy(true);
    try {
      await onCreate(name.trim(), type);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add new agent" onClose={onClose}>
      <div className="form-field">
        <label className="form-field__label">Name</label>
        <input
          autoFocus
          className="form-field__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-agent"
        />
      </div>

      <div className="form-field">
        <label className="form-field__label">Type</label>
        {entries.length === 0 ? (
          <div className="form-field__hint">
            No agent runtimes installed yet. Go to the Install tab first.
          </div>
        ) : (
          <div className="new-agent-modal__types">
            {entries.map((e) => (
              <button
                key={e.name}
                type="button"
                className={`new-agent-modal__type${type === e.name ? ' new-agent-modal__type--active' : ''}`}
                onClick={() => setType(e.name)}
              >
                <AgentIcon type={e.name} size={20} />
                <span>{e.label || e.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <div className="form-field__hint" style={{ color: 'var(--danger-text)' }}>{error}</div>}

      <div className="modal__actions">
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={handleSubmit} loading={busy}>
          Create
        </Button>
      </div>
    </Modal>
  );
}
