'use client';

/* eslint-disable @next/next/no-img-element */

interface IconProps {
  className?: string;
  size?: number;
}

const ICON_BASE = '/icons/agents';

export function AgentIcon({ name, className, size = 20 }: { name: string } & IconProps) {
  const src = `${ICON_BASE}/${name}.svg`;
  return (
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      className={className}
      onError={(e) => {
        (e.target as HTMLImageElement).src = `${ICON_BASE}/default.svg`;
      }}
    />
  );
}

export function ProviderIcon({ name, className, size = 20 }: { name: string } & IconProps) {
  const src = `${ICON_BASE}/${name}.svg`;
  return (
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      className={className}
      onError={(e) => {
        (e.target as HTMLImageElement).src = `${ICON_BASE}/default.svg`;
      }}
    />
  );
}
