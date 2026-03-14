'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceMessage } from '@/lib/types';

interface UsePollingOptions {
  sessionId: string | null;
  enabled?: boolean;
  /** Pre-loaded messages to display immediately (avoids loading state). */
  initialMessages?: WorkspaceMessage[];
}

export function useMessagePolling({ sessionId, enabled = true, initialMessages }: UsePollingOptions) {
  const [messages, setMessages] = useState<WorkspaceMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const lastSeenIdRef = useRef<string | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const initialLoadDoneRef = useRef(false);
  const needsBackfillRef = useRef(false);
  // Track current session to discard stale poll responses
  const currentSessionRef = useRef<string | null>(sessionId);

  // Reset when session changes
  useEffect(() => {
    currentSessionRef.current = sessionId;
    // Seed with initial messages if provided (instant display, no loading)
    if (initialMessages && initialMessages.length > 0) {
      setMessages(initialMessages);
      lastSeenIdRef.current = initialMessages[initialMessages.length - 1].messageId;
      initialLoadDoneRef.current = true;
      needsBackfillRef.current = true; // backfill full history in background
      setLoading(false);
    } else {
      setMessages([]);
      lastSeenIdRef.current = null;
      initialLoadDoneRef.current = false;
      needsBackfillRef.current = false;
      setLoading(false);
    }
  }, [sessionId]); // intentionally omit initialMessages — only seed on session change

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

  // Background backfill: when seeded with partial cache, fetch full history once
  const backfill = useCallback(async () => {
    if (!sessionId || !needsBackfillRef.current) return;
    needsBackfillRef.current = false;

    try {
      // Fetch all messages from the beginning (no cursor)
      let allMessages: WorkspaceMessage[] = [];
      let cursor: string | undefined;
      let hasMore = true;
      while (hasMore) {
        const result = await workspaceApi.pollMessages(sessionId, cursor);
        if (sessionId !== currentSessionRef.current) return;
        allMessages = [...allMessages, ...result.messages];
        hasMore = result.hasMore && result.messages.length > 0;
        if (result.messages.length > 0) {
          cursor = result.messages[result.messages.length - 1].messageId;
        }
      }

      if (sessionId !== currentSessionRef.current) return;

      if (allMessages.length > 0) {
        lastSeenIdRef.current = allMessages[allMessages.length - 1].messageId;
        setMessages(allMessages);
      }
    } catch {
      // Backfill failed — seeded messages still work fine
    }
  }, [sessionId]);

  // Polling loop
  useEffect(() => {
    if (!sessionId || !enabled) return;

    // Initial load (or backfill if seeded)
    if (needsBackfillRef.current) {
      backfill();
    } else {
      poll();
    }

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
  }, [sessionId, enabled, poll, backfill]);

  // Force immediate poll (after sending a message)
  const forceRefresh = useCallback(() => {
    lastActivityRef.current = Date.now();
    poll();
  }, [poll]);

  return { messages, loading, forceRefresh };
}
