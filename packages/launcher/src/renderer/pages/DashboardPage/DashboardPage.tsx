import type { TabName } from '@shared/models';

import { AgentIcon, Badge, Button, Card, EmptyState, StatusDot } from '../../components';
import { useAgents } from '../../hooks/useAgents';
import { displayState, formatHealthLabel, isRunning } from '../../lib/format';
import { useAgentsStore } from '../../store/agentsStore';
import { useUiStore } from '../../store/uiStore';

import { ActivityLog } from './ActivityLog';
import './DashboardPage.css';

interface DashboardPageProps {
  active: boolean;
  onSwitchTab: (tab: TabName) => void;
}

export function DashboardPage({ active, onSwitchTab }: DashboardPageProps): JSX.Element {
  const { toggleAgent } = useAgents({ pollMs: active ? 5000 : 0 });
  const agents = useAgentsStore((s) => s.agents);
  const pendingActions = useAgentsStore((s) => s.pendingActions);
  const pushToast = useUiStore((s) => s.pushToast);

  const handleToggle = async (name: string, state: string): Promise<void> => {
    try {
      await toggleAgent(name, state);
      pushToast(
        isRunning({ state }) ? `Stopping ${name}…` : `Starting ${name}…`,
        'info',
      );
    } catch (e) {
      pushToast(`Failed: ${(e as Error).message}`, 'error');
    }
  };

  return (
    <section className="page page-dashboard">
      <h1>Dashboard</h1>

      {agents.length === 0 ? (
        <EmptyState
          title="No agents configured yet."
          description="Add your first agent to get started."
          action={
            <Button variant="primary" onClick={() => onSwitchTab('agents')}>
              Add Agent
            </Button>
          }
        />
      ) : (
        <div className="card-grid">
          {agents.map((a) => {
            const running = isRunning(a);
            const pending = pendingActions.has(a.name);
            return (
              <Card key={a.name} className="agent-card" padded>
                <div className="agent-card__header">
                  <AgentIcon type={a.type} size={28} />
                  <div className="agent-card__heading">
                    <div className="agent-card__name">{a.name}</div>
                    <div className="agent-card__type">{a.type}</div>
                  </div>
                  <StatusDot status={a.state} />
                </div>

                <div className="agent-card__status-row">
                  <span className="agent-card__state">{displayState(a.state)}</span>
                  <Badge tone={a.health?.ready ? 'success' : 'muted'}>
                    {formatHealthLabel(a.health)}
                  </Badge>
                </div>

                {a.lastError && (
                  <div className="agent-card__error" title={a.lastError}>
                    {a.lastError}
                  </div>
                )}

                <div className="agent-card__actions">
                  <Button
                    size="sm"
                    variant={running ? 'default' : 'primary'}
                    loading={pending}
                    onClick={() => handleToggle(a.name, a.state)}
                  >
                    {running ? 'Stop' : 'Start'}
                  </Button>
                  <Button size="sm" onClick={() => onSwitchTab('agents')}>
                    Configure
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ActivityLog />
    </section>
  );
}
