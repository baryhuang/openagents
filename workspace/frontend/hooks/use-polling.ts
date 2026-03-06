'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceMessage } from '@/lib/types';

interface UsePollingOptions {
  sessionId: string | null;
  enabled?: boolean;
}

export function useMessagePolling({ sessionId, enabled = true }: UsePollingOptions) {
  const [messages, setMessages] = useState<WorkspaceMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const lastSeenIdRef = useRef<string | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const initialLoadDoneRef = useRef(false);
  // Track current session to discard stale poll responses
  const currentSessionRef = useRef<string | null>(sessionId);

  // Reset when session changes
  useEffect(() => {
    currentSessionRef.current = sessionId;
    setMessages([]);
    lastSeenIdRef.current = null;
    initialLoadDoneRef.current = false;
    setLoading(false);
  }, [sessionId]);

  // Track user activity for adaptive polling
  useEffect(() => {
    const onActivity = () => {
      lastActivityRef.current = Date.now();
    };
    window.addEventListener('keydown', onActivity);
    window.addEventListener('click', onActivity);
    return () => {
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('click', onActivity);
    };
  }, []);

  const poll = useCallback(async () => {
    if (!sessionId) return;

    try {
      const isInitial = !initialLoadDoneRef.current;

      if (isInitial) {
        setLoading(true);
      }

      // Keep fetching while there are more events (handles bursts of status messages)
      let hasMore = true;
      while (hasMore) {
        const result = await workspaceApi.pollMessages(
          sessionId,
          isInitial && !lastSeenIdRef.current ? undefined : (lastSeenIdRef.current ?? undefined),
        );

        // Discard response if session changed while request was in flight
        if (sessionId !== currentSessionRef.current) return;

        const newMessages = result.messages;
        hasMore = result.hasMore && newMessages.length > 0;

        if (newMessages.length > 0) {
          const lastMsg = newMessages[newMessages.length - 1];
          lastSeenIdRef.current = lastMsg.messageId;

          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.messageId));
            const unique = newMessages.filter((m) => !existingIds.has(m.messageId));
            return unique.length > 0 ? [...prev, ...unique] : prev;
          });
        }
      }

      if (isInitial) {
        initialLoadDoneRef.current = true;
        setLoading(false);
      }
    } catch {
      if (!initialLoadDoneRef.current) {
        setLoading(false);
      }
    }
  }, [sessionId]);

  // Polling loop
  useEffect(() => {
    if (!sessionId || !enabled) return;

    // Initial load
    poll();

    const getDelay = () => {
      const idle = Date.now() - lastActivityRef.current;
      return idle > 60_000 ? 15_000 : 2_000;
    };

    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timeout = setTimeout(async () => {
        await poll();
        schedule();
      }, getDelay());
    };
    schedule();

    return () => clearTimeout(timeout);
  }, [sessionId, enabled, poll]);

  // Force immediate poll (after sending a message)
  const forceRefresh = useCallback(() => {
    lastActivityRef.current = Date.now();
    poll();
  }, [poll]);

  return { messages, loading, forceRefresh };
}
