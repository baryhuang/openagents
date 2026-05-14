import { useEffect, useRef, useState } from 'react';

import type { InstallOutput } from '@shared/models';

import { ipc } from '../lib/api';

interface UseInstallStreamOptions {
  onChunk?: (text: string) => void;
  /** When true, attach the listener and clean up on unmount. */
  enabled?: boolean;
}

interface UseInstallStreamResult {
  output: string;
  clear: () => void;
}

/**
 * Listens to `install:output` events from main while `enabled` is true.
 * Accumulates the output as a single string for easy display.
 */
export function useInstallStream({ onChunk, enabled = true }: UseInstallStreamOptions = {}): UseInstallStreamResult {
  const [output, setOutput] = useState('');
  const onChunkRef = useRef(onChunk);
  onChunkRef.current = onChunk;

  useEffect(() => {
    if (!enabled) return undefined;
    const handler = (data: InstallOutput | string): void => {
      const text = typeof data === 'string' ? data : data.text;
      setOutput((prev) => prev + text);
      onChunkRef.current?.(text);
    };
    ipc().onInstallOutput(handler);
    return () => {
      ipc().removeInstallOutputListener();
    };
  }, [enabled]);

  return {
    output,
    clear: () => setOutput(''),
  };
}
