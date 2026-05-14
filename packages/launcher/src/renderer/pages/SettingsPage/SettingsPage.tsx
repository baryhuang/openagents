import { Button, Card, EmptyState } from '../../components';
import { useDaemonStatus } from '../../hooks/useDaemonStatus';
import { useSettings } from '../../hooks/useSettings';
import { useWorkspaces } from '../../hooks/useWorkspaces';
import { ipc } from '../../lib/api';
import { useDaemonStore } from '../../store/daemonStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useUiStore } from '../../store/uiStore';
import { useWorkspacesStore } from '../../store/workspacesStore';

import './SettingsPage.css';

export function SettingsPage(): JSX.Element {
  const { refreshRuntime } = useDaemonStatus();
  const { setSetting } = useSettings();
  const { remove: removeWorkspace } = useWorkspaces();

  const settings = useSettingsStore((s) => s.settings);
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const runtime = useDaemonStore((s) => s.runtime);
  const launcherVersion = useDaemonStore((s) => s.launcherVersion);
  const pushToast = useUiStore((s) => s.pushToast);

  const startOnBoot = settings.startOnBoot === true;
  const minimizeToTray = settings.minimizeToTray !== false; // default on

  const onToggle = async (key: 'startOnBoot' | 'minimizeToTray', value: boolean): Promise<void> => {
    await setSetting(key, value);
  };

  const onRemoveWorkspace = async (slug: string): Promise<void> => {
    if (!window.confirm(`Remove workspace "${slug}"?`)) return;
    try {
      await removeWorkspace(slug);
      pushToast('Workspace removed', 'success');
    } catch (e) {
      pushToast(`Failed: ${(e as Error).message}`, 'error');
    }
  };

  const onUpdateCore = async (): Promise<void> => {
    pushToast('Updating core library…', 'info');
    try {
      const res = await ipc().updateCore();
      if (res.success) {
        pushToast(`Core updated · v${res.version ?? '?'}`, 'success');
        await refreshRuntime();
      } else {
        pushToast(res.error || 'Update failed', 'error');
      }
    } catch (e) {
      pushToast((e as Error).message, 'error');
    }
  };

  const updateAvailable =
    runtime?.coreVersion &&
    runtime?.latestVersion &&
    runtime.coreVersion !== runtime.latestVersion;

  return (
    <section className="page page-settings">
      <h1>Settings</h1>

      <Card title="General" padded>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={startOnBoot}
            onChange={(e) => void onToggle('startOnBoot', e.target.checked)}
          />
          Start on system boot
        </label>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={minimizeToTray}
            onChange={(e) => void onToggle('minimizeToTray', e.target.checked)}
          />
          Minimize to tray on close
        </label>
      </Card>

      <Card title="Workspaces" padded>
        {workspaces.length === 0 ? (
          <EmptyState title="No workspaces" description="Connect an agent to a workspace from the Agents tab." />
        ) : (
          <ul className="workspaces-settings">
            {workspaces.map((w) => (
              <li key={w.slug} className="workspaces-settings__item">
                <div>
                  <strong>{w.name}</strong>
                  <span>{w.slug}</span>
                </div>
                <Button size="sm" variant="danger" onClick={() => void onRemoveWorkspace(w.slug)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Runtime" padded>
        <div className="status-row">
          <span>Node.js:</span>
          <span>{runtime?.nodeVersion ?? 'Checking...'}</span>
        </div>
        <div className="status-row">
          <span>npm:</span>
          <span>{runtime?.npmVersion ?? 'Checking...'}</span>
        </div>
        <div className="status-row">
          <span>Core Library:</span>
          <span>{runtime?.coreVersion ?? 'Checking...'}</span>
        </div>
        <div className="status-row">
          <span>Latest Available:</span>
          <span>{runtime?.latestVersion ?? 'Checking...'}</span>
        </div>
        {updateAvailable && (
          <div className="settings__update-row">
            <span>Update available.</span>
            <Button size="sm" variant="primary" onClick={() => void onUpdateCore()}>
              Update Core
            </Button>
          </div>
        )}
      </Card>

      <Card title="About" padded>
        <p>OpenAgents Launcher v{launcherVersion ?? '--'}</p>
        <p>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              void ipc().openExternal('https://github.com/openagents-org/openagents');
            }}
          >
            Documentation
          </a>
        </p>
      </Card>
    </section>
  );
}
