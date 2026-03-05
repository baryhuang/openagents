'use client';

import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { workspaceApi } from './api';
import { networkAgentToWorkspaceAgent, networkChannelToSession } from './types';
import type { BrowserTab, Workspace, WorkspaceAgent, WorkspaceFile, WorkspaceSession } from './types';

interface LastMessageInfo {
  content: string;
  senderName: string;
}

interface WorkspaceContextValue {
  workspace: Workspace | null;
  agents: WorkspaceAgent[];
  sessions: WorkspaceSession[];
  files: WorkspaceFile[];
  selectedFileId: string | null;
  currentSessionId: string | null;
  loading: boolean;
  error: string | null;
  lastMessageBySession: Record<string, LastMessageInfo>;
  activeSessionIds: Set<string>;
  agentModes: Record<string, string>;
  updateLastMessage: (sessionId: string, senderName: string, content: string) => void;
  setSessionActive: (sessionId: string, active: boolean) => void;
  updateAgentMode: (agentName: string, mode: string) => void;
  toggleAgentMode: (agentName: string) => void;
  stopAllAgents: () => Promise<void>;
  setCurrentSessionId: (id: string | null) => void;
  setSelectedFileId: (id: string | null) => void;
  createSession: (opts?: { title?: string; master?: string; participants?: string[] }) => Promise<WorkspaceSession>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  refreshAgents: () => Promise<void>;
  refreshFiles: () => Promise<void>;
  uploadFile: (file: File) => Promise<WorkspaceFile>;
  deleteFile: (fileId: string) => Promise<void>;
  browserTabs: BrowserTab[];
  selectedBrowserTabId: string | null;
  setSelectedBrowserTabId: (id: string | null) => void;
  refreshBrowserTabs: () => Promise<void>;
  openBrowserTab: (url?: string) => Promise<BrowserTab>;
  closeBrowserTab: (tabId: string) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}

export function WorkspaceProvider({
  workspaceId,
  token,
  bearerToken,
  children,
}: {
  workspaceId: string;
  token: string;
  bearerToken?: string;
  children: React.ReactNode;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [agents, setAgents] = useState<WorkspaceAgent[]>([]);
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastMessageBySession, setLastMessageBySession] = useState<Record<string, LastMessageInfo>>({});
  const [activeSessionIds, setActiveSessionIds] = useState<Set<string>>(new Set());
  const [agentModes, setAgentModes] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([]);
  const [selectedBrowserTabId, setSelectedBrowserTabId] = useState<string | null>(null);

  const updateLastMessage = useCallback((sessionId: string, senderName: string, content: string) => {
    setLastMessageBySession((prev) => {
      if (!content && !prev[sessionId]) return prev;
      const existing = prev[sessionId];
      const truncated = content.slice(0, 100);
      if (existing && existing.content === truncated && existing.senderName === senderName) {
        return prev;
      }
      return {
        ...prev,
        [sessionId]: { senderName, content: truncated },
      };
    });
  }, []);

  const setSessionActive = useCallback((sessionId: string, active: boolean) => {
    setActiveSessionIds((prev) => {
      const next = new Set(prev);
      if (active) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  }, []);

  const updateAgentMode = useCallback((agentName: string, mode: string) => {
    setAgentModes((prev) => {
      if (prev[agentName] === mode) return prev;
      return { ...prev, [agentName]: mode };
    });
  }, []);

  const toggleAgentMode = useCallback(async (agentName: string) => {
    const current = agentModes[agentName] || 'execute';
    const next = current === 'execute' ? 'plan' : 'execute';
    // Optimistic update
    setAgentModes((prev) => ({ ...prev, [agentName]: next }));
    try {
      await workspaceApi.sendAgentControl(agentName, 'set_mode', { mode: next });
    } catch {
      // Revert on failure
      setAgentModes((prev) => ({ ...prev, [agentName]: current }));
    }
  }, [agentModes]);

  const stopAllAgents = useCallback(async () => {
    await Promise.allSettled(
      agents.map((a) => workspaceApi.sendAgentControl(a.agentName, 'stop'))
    );
  }, [agents]);

  // Configure API client on mount
  useEffect(() => {
    workspaceApi.configure(workspaceId, token, bearerToken || undefined);
  }, [workspaceId, token, bearerToken]);

  const refreshWorkspace = useCallback(async () => {
    try {
      const ws = await workspaceApi.getWorkspace();
      setWorkspace(ws);
      setAgents(ws.agents);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace');
    }
  }, []);

  /** Refresh agents and channels from the discover endpoint. */
  const refreshDiscovery = useCallback(async () => {
    try {
      const discovery = await workspaceApi.discover();
      setAgents(discovery.agents.map(networkAgentToWorkspaceAgent));
      setSessions((prev) => {
        const updated = discovery.channels.map((ch) =>
          networkChannelToSession(ch, workspaceId)
        );
        // Preserve order: keep existing session order, append new ones
        const existingIds = new Set(prev.map((s) => s.sessionId));
        const newChannels = updated.filter((s) => !existingIds.has(s.sessionId));
        // Update titles for existing sessions
        const updatedMap = new Map(updated.map((s) => [s.sessionId, s]));
        const merged = prev.map((s) => updatedMap.get(s.sessionId) || s);
        return [...merged, ...newChannels];
      });
    } catch {
      // Non-critical — keep existing state
    }
  }, [workspaceId]);

  // Alias for backward compat
  const refreshAgents = refreshDiscovery;

  const refreshFiles = useCallback(async () => {
    try {
      const result = await workspaceApi.listFiles();
      setFiles(result.files);
    } catch {
      // Non-critical
    }
  }, []);

  const uploadFile = useCallback(async (file: File) => {
    const result = await workspaceApi.uploadFile(file);
    await refreshFiles();
    return result;
  }, [refreshFiles]);

  const deleteFile = useCallback(async (fileId: string) => {
    await workspaceApi.deleteFile(fileId);
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    if (selectedFileId === fileId) setSelectedFileId(null);
  }, [selectedFileId]);

  const refreshBrowserTabs = useCallback(async () => {
    try {
      const result = await workspaceApi.listBrowserTabs();
      setBrowserTabs(result.tabs);
    } catch {
      // Non-critical
    }
  }, []);

  const openBrowserTab = useCallback(async (url = 'about:blank') => {
    const tab = await workspaceApi.openBrowserTab(url);
    await refreshBrowserTabs();
    return tab;
  }, [refreshBrowserTabs]);

  const closeBrowserTab = useCallback(async (tabId: string) => {
    await workspaceApi.closeBrowserTab(tabId);
    setBrowserTabs((prev) => prev.filter((t) => t.id !== tabId));
    if (selectedBrowserTabId === tabId) setSelectedBrowserTabId(null);
  }, [selectedBrowserTabId]);

  // Initial load: workspace metadata + discover for channels
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [ws, discovery] = await Promise.all([
          workspaceApi.getWorkspace(),
          workspaceApi.discover(),
          workspaceApi.listFiles().then((r) => setFiles(r.files)).catch(() => {}),
          workspaceApi.listBrowserTabs().then((r) => setBrowserTabs(r.tabs)).catch(() => {}),
        ]);
        if (cancelled) return;

        setWorkspace(ws);
        setAgents(discovery.agents.map(networkAgentToWorkspaceAgent));

        const channelSessions = discovery.channels.map((ch) =>
          networkChannelToSession(ch, workspaceId)
        );
        setSessions(channelSessions);

        // Auto-select first session
        if (channelSessions.length > 0 && !currentSessionId) {
          setCurrentSessionId(channelSessions[0].sessionId);
        }

        // Fetch last message preview for each channel
        const previews = await Promise.all(
          channelSessions.map(async (s) => {
            try {
              const result = await workspaceApi.pollEvents({
                channel: s.sessionId,
                type: 'workspace.message',
                limit: 10,
              });
              // Find last non-status message
              const chatEvents = result.events.filter(
                (e) => ((e.payload as Record<string, string>)?.message_type || 'chat') !== 'status'
              );
              const last = chatEvents[chatEvents.length - 1];
              if (last) {
                const sender = last.source.replace(/^(openagents:|human:)/, '');
                const content = (last.payload as Record<string, string>)?.content || '';
                return { sessionId: s.sessionId, senderName: sender, content };
              }
            } catch { /* ignore */ }
            return null;
          })
        );
        if (!cancelled) {
          const batch: Record<string, LastMessageInfo> = {};
          for (const p of previews) {
            if (p && p.content) {
              batch[p.sessionId] = { senderName: p.senderName, content: p.content.slice(0, 100) };
            }
          }
          setLastMessageBySession((prev) => ({ ...prev, ...batch }));
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load workspace');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Discovery polling (every 15s — refreshes both agents and channels)
  useEffect(() => {
    const interval = setInterval(refreshDiscovery, 15_000);
    return () => clearInterval(interval);
  }, [refreshDiscovery]);

  const createSession = useCallback(async (opts?: { title?: string; master?: string; participants?: string[] }) => {
    const masterAgent = opts?.master || agents.find((a) => a.role === 'master')?.agentName;
    const participants = opts?.participants || agents.map((a) => a.agentName);

    const session = await workspaceApi.createChannel({
      title: opts?.title,
      master: masterAgent,
      participants,
    });
    setSessions((prev) => [session, ...prev]);
    setCurrentSessionId(session.sessionId);
    return session;
  }, [agents]);

  const renameSession = useCallback(async (sessionId: string, title: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.sessionId === sessionId ? { ...s, title } : s))
    );
    try {
      await workspaceApi.updateChannel(sessionId, { title });
    } catch {
      // Best-effort — local update already applied
    }
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        workspace,
        agents,
        sessions,
        files,
        selectedFileId,
        currentSessionId,
        loading,
        error,
        lastMessageBySession,
        activeSessionIds,
        agentModes,
        updateLastMessage,
        setSessionActive,
        updateAgentMode,
        toggleAgentMode,
        stopAllAgents,
        setCurrentSessionId,
        setSelectedFileId,
        createSession,
        renameSession,
        refreshWorkspace,
        refreshAgents,
        refreshFiles,
        uploadFile,
        deleteFile,
        browserTabs,
        selectedBrowserTabId,
        setSelectedBrowserTabId,
        refreshBrowserTabs,
        openBrowserTab,
        closeBrowserTab,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
