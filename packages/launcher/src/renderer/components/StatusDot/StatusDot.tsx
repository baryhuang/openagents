import './StatusDot.css';

export type StatusKind = 'online' | 'offline' | 'partial' | 'warning' | 'idle' | 'starting';

interface StatusDotProps {
  status: StatusKind | string;
  size?: 'sm' | 'md';
}

function normalize(status: string): StatusKind {
  switch (status) {
    case 'online':
    case 'running':
    case 'idle':
      return 'online';
    case 'partial':
      return 'partial';
    case 'starting':
    case 'reconnecting':
      return 'starting';
    case 'warning':
      return 'warning';
    case 'offline':
    case 'stopped':
    case 'unknown':
    default:
      return 'offline';
  }
}

export function StatusDot({ status, size = 'sm' }: StatusDotProps): JSX.Element {
  const kind = normalize(status);
  return <span className={`status-dot status-dot--${kind} status-dot--${size}`} aria-hidden />;
}
