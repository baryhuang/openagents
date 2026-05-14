import type { CSSProperties } from 'react';

import './Skeleton.css';

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({
  width = '100%',
  height = 16,
  radius = 6,
  className,
  style,
}: SkeletonProps): JSX.Element {
  return (
    <span
      className={['skeleton', className].filter(Boolean).join(' ')}
      style={{
        width,
        height,
        borderRadius: radius,
        ...style,
      }}
    />
  );
}

export function SkeletonRows({ rows = 3, height = 16 }: { rows?: number; height?: number }): JSX.Element {
  return (
    <div className="skeleton-rows">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={height} />
      ))}
    </div>
  );
}
