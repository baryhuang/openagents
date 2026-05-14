import { useEffect, useState } from 'react';

import type { AgentEnv, FieldSchema } from '@shared/models';

import { Button, FormField, Modal, Spinner } from '../../components';
import { ipc } from '../../lib/api';

interface ConfigureAgentModalProps {
  agentName: string;
  agentType: string;
  onClose: () => void;
  onSaved: () => void;
}

export function ConfigureAgentModal({
  agentName,
  agentType,
  onClose,
  onSaved,
}: ConfigureAgentModalProps): JSX.Element {
  const [fields, setFields] = useState<FieldSchema[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    void (async (): Promise<void> => {
      const schema = await ipc().getEnvFields(agentType);
      const env = await ipc().getAgentInstanceEnv(agentName);
      const stringValues: Record<string, string> = {};
      for (const k of Object.keys(env || {})) {
        const v = env[k];
        stringValues[k] = v == null ? '' : String(v);
      }
      setFields(schema);
      setValues(stringValues);
    })();
  }, [agentName, agentType]);

  const handleSave = async (): Promise<void> => {
    setBusy(true);
    try {
      const env: AgentEnv = {};
      for (const k of Object.keys(values)) env[k] = values[k];
      await ipc().saveAgentInstanceEnv(agentName, env);
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      const env: AgentEnv = {};
      for (const k of Object.keys(values)) env[k] = values[k];
      const res = await ipc().testLLM(env);
      setTestResult(res.success ? `OK · ${res.model ?? ''}` : res.error || 'Test failed');
    } catch (e) {
      setTestResult((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal title={`Configure ${agentName}`} onClose={onClose} width={520}>
      {!fields ? (
        <Spinner label="Loading configuration…" />
      ) : fields.length === 0 ? (
        <p>This agent has no configuration fields.</p>
      ) : (
        fields.map((f) => (
          <FormField
            key={f.name}
            schema={f}
            value={values[f.name] ?? ''}
            onChange={(v) => setValues((prev) => ({ ...prev, [f.name]: v }))}
          />
        ))
      )}

      {testResult && <div className="form-field__hint">{testResult}</div>}

      <div className="modal__actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleTest} loading={testing}>Test Connection</Button>
        <Button variant="primary" onClick={handleSave} loading={busy}>Save</Button>
      </div>
    </Modal>
  );
}
