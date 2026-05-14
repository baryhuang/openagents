import { useEffect } from 'react';

import type { TabName } from '@shared/models';

import { ModalHost, Sidebar, ToastHost } from './components';
import { useDaemonStatus } from './hooks/useDaemonStatus';
import { AgentsPage, DashboardPage, InstallPage, LogsPage, SettingsPage } from './pages';
import { useUiStore } from './store/uiStore';

import './App.css';

export function App(): JSX.Element {
  const currentTab = useUiStore((s) => s.currentTab);
  const switchTab = useUiStore((s) => s.switchTab);

  // Kick off runtime info / core-update listener at the top level so it stays
  // mounted while users navigate between tabs.
  useDaemonStatus();

  // Ctrl/Cmd + 1..5 jumps between tabs.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const map: Record<string, TabName> = {
        '1': 'dashboard',
        '2': 'agents',
        '3': 'install',
        '4': 'logs',
        '5': 'settings',
      };
      const tab = map[e.key];
      if (tab) {
        e.preventDefault();
        switchTab(tab);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [switchTab]);

  return (
    <div className="app-shell">
      <Sidebar currentTab={currentTab} onSwitchTab={switchTab} />
      <main className="app-content">
        {currentTab === 'dashboard' && (
          <DashboardPage active onSwitchTab={switchTab} />
        )}
        {currentTab === 'agents' && <AgentsPage active />}
        {currentTab === 'install' && <InstallPage />}
        {currentTab === 'logs' && <LogsPage />}
        {currentTab === 'settings' && <SettingsPage />}
      </main>
      <ModalHost />
      <ToastHost />
    </div>
  );
}
