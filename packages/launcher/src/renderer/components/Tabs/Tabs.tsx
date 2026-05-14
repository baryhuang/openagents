import type { ReactNode } from 'react';

import './Tabs.css';

interface TabsProps<T extends string> {
  items: ReadonlyArray<{ key: T; label: ReactNode; icon?: ReactNode }>;
  value: T;
  onChange(value: T): void;
}

export function Tabs<T extends string>({ items, value, onChange }: TabsProps<T>): JSX.Element {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.key}
          role="tab"
          aria-selected={item.key === value}
          className={`tabs__item${item.key === value ? ' tabs__item--active' : ''}`}
          onClick={() => onChange(item.key)}
        >
          {item.icon && <span className="tabs__icon">{item.icon}</span>}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
