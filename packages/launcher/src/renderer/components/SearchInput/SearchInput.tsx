import type { ChangeEvent } from 'react';

import './SearchInput.css';

interface SearchInputProps {
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  autoFocus,
}: SearchInputProps): JSX.Element {
  return (
    <input
      className="search-input"
      type="search"
      autoComplete="off"
      autoFocus={autoFocus}
      placeholder={placeholder}
      value={value}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
    />
  );
}
