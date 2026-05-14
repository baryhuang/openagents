import { useEffect, useRef, useState } from 'react';

import { Button, Spinner } from '../../components';
import { useInstallStream } from '../../hooks/useInstallStream';

interface InstallProgressOverlayProps {
  title: string;
  promise: Promise<void>;
  onDone: (success: boolean, error?: string) => void;
}

export function InstallProgressOverlay({
  title,
  promise,
  onDone,
}: InstallProgressOverlayProps): JSX.Element {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastOutputAt, setLastOutputAt] = useState(Date.now());
  const logRef = useRef<HTMLTextAreaElement | null>(null);

  const { output } = useInstallStream({
    onChunk: () => setLastOutputAt(Date.now()),
  });

  useEffect(() => {
    promise
      .then(() => {
        setDone(true);
        onDone(true);
      })
      .catch((e: Error) => {
        setDone(true);
        setError(e.message);
        onDone(false, e.message);
      });
  }, [promise, onDone]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [output]);

  const idleSeconds = Math.floor((Date.now() - lastOutputAt) / 1000);

  return (
    <div className="install-progress">
      <div className="install-progress__header">
        <strong>{title}</strong>
        {!done && idleSeconds >= 2 && <Spinner label={`Working… ${idleSeconds}s`} />}
      </div>
      <textarea
        ref={logRef}
        className="install-progress__log"
        readOnly
        value={output}
      />
      {done && (
        <div className="install-progress__result">
          {error ? <span style={{ color: 'var(--danger-text)' }}>{error}</span> : <span>Done.</span>}
          <Button variant="primary" onClick={() => onDone(!error)}>Close</Button>
        </div>
      )}
    </div>
  );
}
