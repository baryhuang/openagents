'use client';

// localStorage-backed recent-workspaces list, mirrors the Swift
// `WorkspaceHistory` shape so the switcher popover can list past
// workspaces the same way the macOS/iOS app's selector view does.

export interface WorkspaceHistoryEntry {
  workspaceId: string;
  workspaceToken: string;
  name?: string;
  // ISO timestamp of the most recent open. Used to sort.
  lastOpenedAt: string;
}

const KEY = 'oa_workspace_history_v1';
const MAX_ENTRIES = 12;

function read(): WorkspaceHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e) =>
        e && typeof e.workspaceId === 'string' && typeof e.workspaceToken === 'string',
    );
  } catch {
    return [];
  }
}

function write(entries: WorkspaceHistoryEntry[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // quota / private-mode failure — silent, history is convenience-only
  }
}

export const WorkspaceHistory = {
  entries(): WorkspaceHistoryEntry[] {
    return read().sort(
      (a, b) => Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt),
    );
  },
  record(entry: Omit<WorkspaceHistoryEntry, 'lastOpenedAt'>) {
    const existing = read().filter((e) => e.workspaceId !== entry.workspaceId);
    write([
      { ...entry, lastOpenedAt: new Date().toISOString() },
      ...existing,
    ]);
  },
  remove(workspaceId: string) {
    write(read().filter((e) => e.workspaceId !== workspaceId));
  },
  clear() {
    write([]);
  },
};

/** Parse a workspace URL like https://host/<id>?token=<t> into its parts. */
export function parseWorkspaceURL(input: string):
  | { workspaceId: string; token: string }
  | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    // First path segment is the workspace id/slug.
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return null;
    const workspaceId = segments[0];
    const token = url.searchParams.get('token') ?? '';
    if (!workspaceId || !token) return null;
    return { workspaceId, token };
  } catch {
    return null;
  }
}
