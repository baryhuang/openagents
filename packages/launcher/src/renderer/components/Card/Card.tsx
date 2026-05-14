import type { HTMLAttributes, ReactNode } from 'react';

import './Card.css';

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  actions?: ReactNode;
  padded?: boolean;
}

export function Card({
  title,
  actions,
  padded = true,
  className,
  children,
  ...rest
}: CardProps): JSX.Element {
  const classes = ['card', padded && 'card--padded', className].filter(Boolean).join(' ');
  return (
    <div className={classes} {...rest}>
      {(title || actions) && (
        <div className="card__header">
          {title && <h3 className="card__title">{title}</h3>}
          {actions && <div className="card__actions">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
