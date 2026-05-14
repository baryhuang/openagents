import { useMemo, useState } from 'react';

import type { CatalogEntry } from '@shared/models';

import { Card, SearchInput, Skeleton, SkeletonRows } from '../../components';
import { useCatalog } from '../../hooks/useCatalog';
import { ipc } from '../../lib/api';
import { useCatalogStore } from '../../store/catalogStore';
import { useUiStore } from '../../store/uiStore';

import { CatalogRow } from './CatalogRow';
import { InstallProgressOverlay } from './InstallProgressOverlay';
import './InstallPage.css';

interface OverlayState {
  title: string;
  promise: Promise<void>;
}

export function InstallPage(): JSX.Element {
  const { refresh } = useCatalog();
  const entries = useCatalogStore((s) => s.entries);
  const loading = useCatalogStore((s) => s.loading);
  const query = useCatalogStore((s) => s.query);
  const setQuery = useCatalogStore((s) => s.setQuery);
  const pushToast = useUiStore((s) => s.pushToast);

  const [busyName, setBusyName] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<OverlayState | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e: CatalogEntry) =>
        e.name.toLowerCase().includes(q) ||
        (e.label || '').toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q),
    );
  }, [entries, query]);

  const handleInstall = (entry: CatalogEntry): void => {
    setBusyName(entry.name);
    const promise = ipc()
      .installAgentTypeStreaming(entry.name)
      .then(() => undefined);
    setOverlay({ title: `Installing ${entry.label || entry.name}…`, promise });
  };

  const handleUninstall = (entry: CatalogEntry): void => {
    if (!window.confirm(`Uninstall ${entry.label || entry.name}?`)) return;
    setBusyName(entry.name);
    const promise = ipc()
      .uninstallAgentTypeStreaming(entry.name)
      .then(() => undefined);
    setOverlay({ title: `Uninstalling ${entry.label || entry.name}…`, promise });
  };

  const handleOverlayDone = (success: boolean, error?: string): void => {
    setOverlay(null);
    setBusyName(null);
    if (success) {
      pushToast('Done', 'success');
      void refresh();
    } else if (error) {
      pushToast(error, 'error');
    }
  };

  if (overlay) {
    return (
      <section className="page">
        <h1>Install</h1>
        <Card padded>
          <InstallProgressOverlay
            title={overlay.title}
            promise={overlay.promise}
            onDone={handleOverlayDone}
          />
        </Card>
      </section>
    );
  }

  return (
    <section className="page page-install">
      <h1>Install</h1>

      <Card title="Agent Runtimes" padded>
        <p className="hint">Select a runtime to install or update.</p>
        <div className="catalog-search">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search agents..."
            autoFocus
          />
        </div>

        {loading && entries.length === 0 ? (
          <SkeletonRows rows={5} height={40} />
        ) : filtered.length === 0 ? (
          <div className="hint">No matching agents.</div>
        ) : (
          <div className="catalog-list">
            {filtered.map((e) => (
              <CatalogRow
                key={e.name}
                entry={e}
                busy={busyName === e.name}
                onInstall={() => handleInstall(e)}
                onUninstall={() => handleUninstall(e)}
              />
            ))}
          </div>
        )}
        {loading && entries.length > 0 && (
          <div className="catalog-list__refreshing">
            <Skeleton width={80} height={12} />
          </div>
        )}
      </Card>
    </section>
  );
}
