'use client';

import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { workspaceApi } from './api';
import { networkAgentToWorkspaceAgent, networkChannelToSession } from './types';
import type { Workspace, WorkspaceAgent, WorkspaceSession } from './types';

interface LastMessageInfo {
  content: string;
  senderName: string;
}

interface WorkspaceContextValue {
  workspace: Workspace | null;
  agents: WorkspaceAgent[];
  sessions: WorkspaceSession[];
  currentSessionId: string | null;
  loading: boolean;
  error: string | null;
  lastMessageBySession: Record<string, LastMessageInfo>;
  updateLastMessage: (sessionId: string, senderName: string, content: string) => void;
  setCurrentSessionId: (id: string | null) => void;
  createSession: (title?: string) => Promise<WorkspaceSession>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  refreshAgents: () => Promise<void>;
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
  children,
}: {
  workspaceId: string;
  token: string;
  children: React.ReactNode;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [agents, setAgents] = useState<WorkspaceAgent[]>([]);
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastMessageBySession, setLastMessageBySession] = useState<Record<string, LastMessageInfo>>({});

  const updateLastMessage = useCallback((sessionId: string, senderName: string, content: string) => {
    setLastMessageBySession((prev) => ({
      ...prev,
      [sessionId]: { senderName, content: content.slice(0, 100) },
    }));
  }, []);

  // Configure API client on mount
  useEffect(() => {
    workspaceApi.configure(workspaceId, token);
  }, [workspaceId, token]);

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

  // Initial load: workspace metadata + discover for channels
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [ws, discovery] = await Promise.all([
          workspaceApi.getWorkspace(),
          workspaceApi.discover(),
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

  const createSession = useCallback(async (title?: string) => {
    // Find workspace master agent for the new channel
    const masterAgent = agents.find((a) => a.role === 'master');
    const allAgentNames = agents.map((a) => a.agentName);

    const session = await workspaceApi.createChannel({
      title,
      master: masterAgent?.agentName,
      participants: allAgentNames,
    });
    setSessions((prev) => [session, ...prev]);
    setCurrentSessionId(session.sessionId);
    return session;
  }, [agents]);

  const renameSession = useCallback(async (sessionId: string, title: string) => {
    // Channel rename would require a new event type — for now, update locally
    setSessions((prev) =>
      prev.map((s) => (s.sessionId === sessionId ? { ...s, title } : s))
    );
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        workspace,
        agents,
        sessions,
        currentSessionId,
        loading,
        error,
        lastMessageBySession,
        updateLastMessage,
        setCurrentSessionId,
        createSession,
        renameSession,
        refreshWorkspace,
        refreshAgents,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
