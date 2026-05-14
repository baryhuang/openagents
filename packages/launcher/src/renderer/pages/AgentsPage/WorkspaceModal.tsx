import { useState } from 'react';

import { Button, Modal } from '../../components';
import { ipc } from '../../lib/api';
import { useWorkspacesStore } from '../../store/workspacesStore';

interface WorkspaceModalProps {
  agentName: string;
  onClose: () => void;
  onConnected: () => void;
}

export function WorkspaceModal({ agentName, onClose, onConnected }: WorkspaceModalProps): JSX.Element {
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const [mode, setMode] = useState<'pick' | 'create' | 'token'>('pick');
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const connect = async (slug: string): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      await ipc().connectWorkspace(agentName, slug);
      onConnected();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      const ws = await ipc().createWorkspace(name || undefined);
      await connect(ws.slug);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={`Connect ${agentName} to workspace`} onClose={onClose}>
      {mode === 'pick' && (
        <>
          <div className="form-field__hint">Pick an existing workspace or create a new one.</div>
          {workspaces.length === 0 ? (
            <div className="form-field__hint">No workspaces yet.</div>
          ) : (
            <div className="workspace-list">
              {workspaces.map((w) => (
                <button
                  key={w.slug}
                  type="button"
                  className="workspace-list__item"
                  onClick={() => connect(w.slug)}
                  disabled={busy}
                >
                  <strong>{w.name}</strong>
                  <span>{w.slug}</span>
                </button>
              ))}
            </div>
          )}
          <div className="modal__actions">
            <Button onClick={onClose}>Cancel</Button>
            <Button onClick={() => setMode('token')}>Join with token</Button>
            <Button variant="primary" onClick={() => setMode('create')}>Create new</Button>
          </div>
        </>
      )}

      {mode === 'create' && (
        <>
          <div className="form-field">
            <label className="form-field__label">Workspace name</label>
            <input
              autoFocus
              className="form-field__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Workspace"
            />
          </div>
          <div className="modal__actions">
            <Button onClick={() => setMode('pick')}>Back</Button>
            <Button variant="primary" onClick={create} loading={busy}>Create &amp; Connect</Button>
          </div>
        </>
      )}

      {mode === 'token' && (
        <>
          <div className="form-field">
            <label className="form-field__label">Workspace token or slug</label>
            <input
              autoFocus
              className="form-field__input"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ws_xxxxx"
            />
          </div>
          <div className="modal__actions">
            <Button onClick={() => setMode('pick')}>Back</Button>
            <Button variant="primary" onClick={() => connect(token)} loading={busy} disabled={!token.trim()}>
              Connect
            </Button>
          </div>
        </>
      )}

      {err && <div className="form-field__hint" style={{ color: 'var(--danger-text)' }}>{err}</div>}
    </Modal>
  );
}
