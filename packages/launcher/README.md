# OpenAgents Launcher

Electron app for installing, configuring, and managing OpenAgents agents.
Renderer is React + TypeScript + Vite + Zustand. Main process is TypeScript.

## Development

```bash
npm install
npm run dev          # Vite renderer + Electron main (auto-reload)
npm run typecheck    # Type-check all three projects
```

## Build

```bash
npm run build        # Compile main + preload + renderer
npm run build:mac    # Package macOS app
npm run build:win    # Package Windows app
npm run build:linux  # Package Linux app
```

## Architecture

```
src/
  shared/                Shared TypeScript types (used by main, preload, renderer)
    api.ts                 IpcApi surface — single source of truth for window.api
    models.ts              Domain types: Agent, Workspace, CatalogEntry, etc.

  main/                  Electron main process (TypeScript, CommonJS)
    main.ts                App lifecycle, BrowserWindow, tray, IPC registration
    agent-manager.ts       Agent CRUD, daemon lifecycle, workspace, catalog
    python-manager.ts      Legacy Node runtime status reporter
    store.ts               JSON-backed settings store
    bootstrap.ts           Portable Node.js / core library installer

  preload/               Electron preload (TypeScript, CommonJS)
    preload.ts             contextBridge exposing typed `window.api`

  renderer/              React app (TypeScript, ESM)
    index.html             Vite entry
    main.tsx               React DOM bootstrap
    App.tsx                Layout shell (sidebar + tab outlet)
    components/            Reusable UI library
      Button/, Card/, Badge/, Modal/, Toast/, StatusDot/,
      Skeleton/, Tabs/, SearchInput/, FormField/
    pages/                 Tab pages
      DashboardPage/, AgentsPage/, InstallPage/, LogsPage/, SettingsPage/
    hooks/                 Typed IPC hooks: useAgents, useDaemonStatus, ...
    store/                 Zustand stores
      agentsStore.ts, daemonStore.ts, logsStore.ts,
      workspacesStore.ts, settingsStore.ts, uiStore.ts
    styles/                Global tokens + component-level CSS
```

See `../launcher-legacy/` for the prior native-JS implementation kept for reference.
