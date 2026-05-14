import type { CatalogEntry } from '@shared/models';

import { AgentIcon, Badge, Button } from '../../components';

interface CatalogRowProps {
  entry: CatalogEntry;
  busy: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}

export function CatalogRow({ entry, busy, onInstall, onUninstall }: CatalogRowProps): JSX.Element {
  return (
    <div className="catalog-row">
      <AgentIcon type={entry.name} size={28} />

      <div className="catalog-row__text">
        <div className="catalog-row__name">{entry.label || entry.name}</div>
        {entry.description && <div className="catalog-row__description">{entry.description}</div>}
        <div className="catalog-row__badges">
          {entry.installed ? (
            <Badge tone="success">Installed</Badge>
          ) : (
            <Badge tone="muted">Not installed</Badge>
          )}
          {entry.managed === false && <Badge tone="info">System</Badge>}
          {entry.support?.workspace && <Badge tone="info">Workspace</Badge>}
        </div>
      </div>

      <div className="catalog-row__actions">
        {entry.installed ? (
          <>
            <Button size="sm" onClick={onInstall} loading={busy}>Update</Button>
            <Button size="sm" variant="danger" onClick={onUninstall} loading={busy}>Uninstall</Button>
          </>
        ) : (
          <Button size="sm" variant="primary" onClick={onInstall} loading={busy}>Install</Button>
        )}
      </div>
    </div>
  );
}
