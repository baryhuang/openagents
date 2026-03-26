# OpenAgents Launcher — Bug Tracker

Last updated: 2026-03-26

## Open Bugs

### BUG-001: Workspace endpoint returns 500 on /v1/discover
- **Status:** Open
- **Severity:** High
- **Component:** workspace-web backend
- **Reported:** 2026-03-26
- **Description:** The `/v1/discover` endpoint returns HTTP 500 Internal Server Error for workspace `5fc4c33d`.
- **Impact:** Agent shows "running" in the Launcher but is invisible in the workspace UI. Daemon logs show repeated "Poll failed: Request timed out" and "Heartbeat failed: Request timed out".
- **Reproduce:**
  ```bash
  curl -s "https://workspace-endpoint.openagents.org/v1/discover?network=5fc4c33d" \
    -H "X-Workspace-Token: EN_m_dzu2PvaU012dMRgRAPYYq3qMMjVz2jGBceWifo"
  # Returns: Internal Server Error (HTTP 500)
  ```
- **Notes:** The workspace web UI loads fine at `https://workspace.openagents.org/5fc4c33d`. The 500 is specifically on the API endpoint. Affects all clients (tested from Windows machine, Linux server).

### BUG-002: OpenClaw shows INSTALLED after uninstall (stale shims)
- **Status:** Fixed in core v0.2.46, needs verification
- **Severity:** Medium
- **Component:** agent-connector/installer.js
- **Description:** After uninstalling OpenClaw, the Install tab still shows "INSTALLED". Caused by npm leaving extensionless shim files (Unix-style) that `where` command finds.
- **Fix:** `isInstalled()` now verifies the actual package exists in `node_modules` before reporting installed. Also `_cleanStaleShims()` removes all shim variants after uninstall.
- **Core version:** v0.2.46+

### BUG-003: Chinese/CJK username breaks npm and openclaw CLI
- **Status:** Fixed in core v0.2.47 + v0.2.48
- **Severity:** High
- **Component:** launcher/main.js, agent-connector/adapters/openclaw.js
- **Description:** Users with Chinese/Japanese/Korean characters in their Windows username (e.g., `C:\Users\王思璠\`) experience garbled paths when running npm.cmd or openclaw.cmd through cmd.exe. Batch files can't handle Unicode paths.
- **Fix:**
  - v0.2.47: `findNpmCommand()` uses `node.exe npm-cli.js` instead of `npm.cmd`
  - v0.2.47: OpenClaw adapter spawns `node.exe openclaw.mjs` instead of `cmd.exe /C openclaw.cmd`
  - v0.2.48: `configureNativeAuth()` creates `~/.openclaw/` directories before writing config
- **Core version:** v0.2.48+

### BUG-004: Core library auto-update notification not shown
- **Status:** Fixed in launcher v0.6.2
- **Severity:** Medium
- **Component:** launcher/main.js
- **Description:** `checkCoreUpdate()` was called before `createWindow()`, so `mainWindow` was null and the notification was never sent to the renderer.
- **Fix:** Moved `checkCoreUpdate()` to after `createWindow()`. Also added periodic check every 4 hours.
- **Launcher version:** v0.6.2+

### BUG-005: Node.js zip extraction fails silently on Windows
- **Status:** Fixed in launcher v0.6.0
- **Severity:** High
- **Component:** launcher/main.js
- **Description:** `Expand-Archive` (PowerShell) silently fails on some Windows machines. The zip downloads but extraction produces empty directory. Also, flattening the nested `node-v22.14.0-win-x64/` folder conflicts with existing `node_modules/`.
- **Fix:** Replaced zip download with direct `node.exe` binary download (85MB single file) + npm tarball extraction via `tar`. No zip, no Expand-Archive, no flattening needed.
- **Launcher version:** v0.6.0+

### BUG-006: Daemon start fails from packaged exe (asar path)
- **Status:** Fixed in launcher v0.4.1+
- **Severity:** Critical
- **Component:** launcher/agent-manager.js
- **Description:** `_startDaemon()` used `require.resolve()` which returned a path inside the asar virtual filesystem. Child processes can't access asar paths, so the daemon crashed with MODULE_NOT_FOUND.
- **Fix:** Search for the CLI at the global portable Node.js path first (`~/.openagents/nodejs/node_modules/@openagents-org/agent-launcher/bin/agent-connector.js`), fall back to `require.resolve` only as last resort.

### BUG-007: Multiple daemon instances cause duplicate responses
- **Status:** Fixed in core v0.2.33+
- **Severity:** High
- **Component:** agent-connector/daemon.js
- **Description:** `restart:` command started a new adapter loop without properly stopping the old one. Multiple adapter loops polled the same workspace, causing each message to be processed 2-5 times.
- **Fix:** Added `_stopToken` per adapter. `restartAgent()` sets the stop token, waits for the old loop to exit, then starts a new one. Also deduplicates log writes.

### BUG-008: Dashboard status flapping (running/stopped)
- **Status:** Fixed in core v0.2.14+
- **Severity:** Medium
- **Component:** agent-connector/daemon.js, launcher/agent-manager.js
- **Description:** Dashboard alternated between showing "running" and "stopped" on every refresh. Caused by `process.kill(pid, 0)` returning EPERM on Windows for cross-session processes, and stale PID/status files from crashed daemons.
- **Fix:** Removed PID validation from `getDaemonPid()`. Added EPERM handling in `_isAlive()`. Always clean status files on daemon stop.

## Resolved Bugs (Closed)

### BUG-R01: Bundled core library version mismatch
- **Status:** Resolved in launcher v0.6.0
- **Description:** Two copies of the core library existed — bundled (asar) and global. They could be different versions, causing inconsistent behavior.
- **Fix:** Removed bundled dependency entirely. Single copy at `~/.openagents/nodejs/node_modules/`. Auto-update on every startup.

### BUG-R02: Install tab freeze after installing agent
- **Status:** Resolved in launcher v0.3.x
- **Description:** After installing openclaw, clicking "Back to Install" didn't work. The entire app froze.
- **Fix:** Fixed event listener registration order — `btn-start-all` and `btn-stop-all` listeners were attached before elements existed, causing JS error that broke all subsequent click handlers.

### BUG-R03: sharp/koffi native module compilation fails
- **Status:** Resolved in core v0.2.44
- **Description:** `npm install -g openclaw` fails because `sharp` and `koffi` post-install scripts can't find `node` on PATH, or require native build tools not present on the machine.
- **Fix:** Added `--ignore-scripts` flag to all npm install commands. OpenClaw works without sharp/koffi (they're optional for image processing).

### BUG-R04: Console window pops up when agent processes message
- **Status:** Resolved in core v0.2.33
- **Description:** On Windows, a visible cmd.exe console window appeared briefly every time the openclaw CLI was invoked to process a workspace message.
- **Fix:** Added `windowsHide: true` to spawn options.
