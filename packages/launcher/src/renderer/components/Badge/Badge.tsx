import type { ReactNode } from 'react';

import './Badge.css';

type BadgeTone = 'success' | 'warning' | 'danger' | 'muted' | 'info';

interface BadgeProps {
  tone?: BadgeTone;
  size?: 'sm' | 'md';
  children: ReactNode;
}

export function Badge({ tone = 'muted', size = 'sm', children }: BadgeProps): JSX.Element {
  return <span className={`badge badge--${tone} badge--${size}`}>{children}</span>;
}
