import type { ButtonHTMLAttributes, ReactNode } from 'react';

import './Button.css';

type Variant = 'default' | 'primary' | 'danger' | 'ghost';
type Size = 'md' | 'sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'default',
  size = 'md',
  loading = false,
  icon,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps): JSX.Element {
  const classes = [
    'btn',
    `btn--${variant}`,
    size === 'sm' && 'btn--sm',
    loading && 'btn--loading',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <span className="btn__spinner" aria-hidden />}
      {!loading && icon && <span className="btn__icon">{icon}</span>}
      {children}
    </button>
  );
}
