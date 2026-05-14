import { useEffect, useRef, useState } from 'react';

import { Button } from '../../components';
import { useAgents } from '../../hooks/useAgents';
import { useLogs } from '../../hooks/useLogs';
import { useAgentsStore } from '../../store/agentsStore';
import { useLogsStore } from '../../store/logsStore';
import { useUiStore } from '../../store/uiStore';

import { ClearLogsModal } from './ClearLogsModal';
import './LogsPage.css';

export function LogsPage(): JSX.Element {
  // Pull the agents list so we can populate the filter dropdown.
  useAgents({ autoLoad: true });
  const agents = useAgentsStore((s) => s.agents);

  const filter = useLogsStore((s) => s.filter);
  const setFilter = useLogsStore((s) => s.setFilter);
  const lines = useLogsStore((s) => s.lines);
  const autoRefresh = useLogsStore((s) => s.autoRefresh);
  const setAutoRefresh = useLogsStore((s) => s.setAutoRefresh);
  const refreshing = useLogsStore((s) => s.refreshing);

  const { refresh, clearRange, copy } = useLogs();
  const pushToast = useUiStore((s) => s.pushToast);
  const [showClear, setShowClear] = useState(false);

  const logBoxRef = useRef<HTMLPreElement | null>(null);
  // Auto-scroll to bottom when new lines arrive and the user is already near the bottom.
  useEffect(() => {
    const el = logBoxRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.clientHeight - el.scrollTop < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const handleClear = async (start: string, end: string): Promise<void> => {
    await clearRange(start, end);
    pushToast('Logs cleared', 'success');
  };

  const handleCopy = async (): Promise<void> => {
    await copy();
    pushToast('Logs copied to clipboard', 'success');
  };

  return (
    <section className="page page-logs">
      <h1>Logs</h1>

      <div className="logs-controls">
        <select
          className="logs-controls__filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.name} value={a.name}>{a.name}</option>
          ))}
        </select>
        <Button size="sm" onClick={() => void refresh()} loading={refreshing}>Refresh</Button>
        <Button size="sm" variant="danger" onClick={() => setShowClear(true)}>Clear Logs</Button>
        <Button size="sm" onClick={() => void handleCopy()}>Copy Logs</Button>
        <label className="logs-controls__auto">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          Auto-refresh
        </label>
      </div>

      <pre ref={logBoxRef} className="log-viewer">
        {lines.length === 0 ? 'No logs available.' : lines.join('\n')}
      </pre>

      {showClear && (
        <ClearLogsModal
          onClose={() => setShowClear(false)}
          onConfirm={handleClear}
        />
      )}
    </section>
  );
}
