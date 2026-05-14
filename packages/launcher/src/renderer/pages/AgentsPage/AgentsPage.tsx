import { useState } from 'react';

import type { Agent } from '@shared/models';

import {
  AgentIcon,
  Badge,
  Button,
  Card,
  EmptyState,
  StatusDot,
} from '../../components';
import { useAgents } from '../../hooks/useAgents';
import { useWorkspaces } from '../../hooks/useWorkspaces';
import { ipc } from '../../lib/api';
import { displayState, formatHealthLabel, isRunning } from '../../lib/format';
import { useAgentsStore } from '../../store/agentsStore';
import { useUiStore } from '../../store/uiStore';

import { ConfigureAgentModal } from './ConfigureAgentModal';
import { NewAgentModal } from './NewAgentModal';
import { WorkspaceModal } from './WorkspaceModal';
import './AgentsPage.css';

interface AgentsPageProps {
  active: boolean;
}

type ModalState =
  | { kind: 'none' }
  | { kind: 'new' }
  | { kind: 'configure'; agent: Agent }
  | { kind: 'workspace'; agent: Agent };

export function AgentsPage({ active }: AgentsPageProps): JSX.Element {
  const { refresh, addAgent, removeAgent, toggleAgent } = useAgents({
    pollMs: active ? 5000 : 0,
  });
  useWorkspaces();
  const agents = useAgentsStore((s) => s.agents);
  const pending = useAgentsStore((s) => s.pendingActions);
  const pushToast = useUiStore((s) => s.pushToast);
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });

  const handleCreate = async (name: string, type: string): Promise<void> => {
    await addAgent({ name, type });
    pushToast(`Created agent ${name}`, 'success');
  };

  const handleRemove = async (a: Agent): Promise<void> => {
    if (!window.confirm(`Remove agent "${a.name}"?`)) return;
    try {
      await removeAgent(a.name);
      pushToast(`Removed ${a.name}`, 'success');
    } catch (e) {
      pushToast(`Failed to remove: ${(e as Error).message}`, 'error');
    }
  };

  const handleDisconnect = async (a: Agent): Promise<void> => {
    try {
      await ipc().disconnectWorkspace(a.name);
      pushToast(`Disconnected ${a.name}`, 'info');
      await refresh();
    } catch (e) {
      pushToast(`Failed: ${(e as Error).message}`, 'error');
    }
  };

  return (
    <section className="page page-agents">
      <div className="page-agents__header">
        <h1>My Agents</h1>
        <Button variant="primary" onClick={() => setModal({ kind: 'new' })}>+ New Agent</Button>
      </div>

      {agents.length === 0 ? (
        <EmptyState
          title="No agents yet"
          description="Create your first agent. You'll need at least one installed runtime."
          action={<Button variant="primary" onClick={() => setModal({ kind: 'new' })}>+ New Agent</Button>}
        />
      ) : (
        <div className="agent-list">
          {agents.map((a) => (
            <Card key={a.name} className="agent-list__item" padded>
              <div className="agent-list__top">
                <AgentIcon type={a.type} size={32} />
                <div className="agent-list__heading">
                  <div className="agent-list__name">{a.name}</div>
                  <div className="agent-list__type">{a.type}</div>
                </div>
                <div className="agent-list__status">
                  <StatusDot status={a.state} />
                  <span>{displayState(a.state)}</span>
                </div>
              </div>

              <div className="agent-list__badges">
                <Badge tone={a.health?.ready ? 'success' : 'muted'}>
                  {formatHealthLabel(a.health)}
                </Badge>
                {a.networkName && <Badge tone="info">Workspace: {a.networkName}</Badge>}
                {a.runtimeMismatch && <Badge tone="warning">Runtime mismatch</Badge>}
              </div>

              {a.lastError && <div className="agent-list__error">{a.lastError}</div>}

              <div className="agent-list__actions">
                <Button
                  size="sm"
                  variant={isRunning(a) ? 'default' : 'primary'}
                  loading={pending.has(a.name)}
                  onClick={() => toggleAgent(a.name, a.state)}
                >
                  {isRunning(a) ? 'Stop' : 'Start'}
                </Button>
                <Button size="sm" onClick={() => setModal({ kind: 'configure', agent: a })}>
                  Configure
                </Button>
                {a.networkName ? (
                  <Button size="sm" onClick={() => handleDisconnect(a)}>Disconnect</Button>
                ) : (
                  <Button size="sm" onClick={() => setModal({ kind: 'workspace', agent: a })}>
                    Connect
                  </Button>
                )}
                <Button size="sm" variant="danger" onClick={() => handleRemove(a)}>Remove</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {modal.kind === 'new' && (
        <NewAgentModal onClose={() => setModal({ kind: 'none' })} onCreate={handleCreate} />
      )}
      {modal.kind === 'configure' && (
        <ConfigureAgentModal
          agentName={modal.agent.name}
          agentType={modal.agent.type}
          onClose={() => setModal({ kind: 'none' })}
          onSaved={() => {
            pushToast(`Saved configuration for ${modal.agent.name}`, 'success');
            void refresh();
          }}
        />
      )}
      {modal.kind === 'workspace' && (
        <WorkspaceModal
          agentName={modal.agent.name}
          onClose={() => setModal({ kind: 'none' })}
          onConnected={() => {
            pushToast(`Connected ${modal.agent.name}`, 'success');
            void refresh();
          }}
        />
      )}
    </section>
  );
}
