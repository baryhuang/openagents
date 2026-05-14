import type { TabName } from '@shared/models';

import { useDaemonStore } from '../../store/daemonStore';
import { StatusDot } from '../StatusDot';
import { Tabs } from '../Tabs';

import './Sidebar.css';

const TAB_ITEMS: ReadonlyArray<{ key: TabName; label: string; icon: string }> = [
  { key: 'dashboard', label: 'Dashboard', icon: '●' },
  { key: 'agents', label: 'Agents', icon: '⚙' },
  { key: 'install', label: 'Install', icon: '↓' },
  { key: 'logs', label: 'Logs', icon: '☰' },
  { key: 'settings', label: 'Settings', icon: '✻' },
];

interface SidebarProps {
  currentTab: TabName;
  onSwitchTab: (tab: TabName) => void;
}

export function Sidebar({ currentTab, onSwitchTab }: SidebarProps): JSX.Element {
  const daemonState = useDaemonStore((s) => s.state);
  const runtime = useDaemonStore((s) => s.runtime);
  const launcherVersion = useDaemonStore((s) => s.launcherVersion);
  const coreUpdate = useDaemonStore((s) => s.coreUpdate);

  const daemonLabel = (() => {
    switch (daemonState) {
      case 'online': return 'Daemon: online';
      case 'partial': return 'Daemon: partial';
      case 'offline': return 'Daemon: offline';
      default: return 'Daemon: starting';
    }
  })();

  return (
    <nav className="sidebar">
      <div className="sidebar__header">
        <h2>OpenAgents Launcher</h2>
      </div>

      <Tabs
        items={TAB_ITEMS.map((t) => ({
          key: t.key,
          label: t.label,
          icon: <span aria-hidden>{t.icon}</span>,
        }))}
        value={currentTab}
        onChange={onSwitchTab}
      />

      <div className="sidebar__footer">
        {coreUpdate && (
          <div className="sidebar__update-banner">
            Update available · v{coreUpdate.latest}
          </div>
        )}
        <div className="sidebar__version-info">
          <span>Launcher: {launcherVersion ?? '--'}</span>
          <span>Core: {runtime?.coreVersion ?? '--'}</span>
        </div>
        <div className="sidebar__daemon" title="Daemon status">
          <StatusDot status={daemonState} />
          <span>{daemonLabel}</span>
        </div>
      </div>
    </nav>
  );
}
