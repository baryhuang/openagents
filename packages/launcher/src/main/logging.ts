import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STARTUP_LOG = path.join(os.homedir(), '.openagents', 'startup.log');

export function slog(msg: string): void {
  try {
    fs.mkdirSync(path.dirname(STARTUP_LOG), { recursive: true });
    fs.appendFileSync(STARTUP_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // best-effort — startup log is non-critical
  }
  // eslint-disable-next-line no-console
  console.log('[startup]', msg);
}
