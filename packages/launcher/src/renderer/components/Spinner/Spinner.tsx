import './Spinner.css';

interface SpinnerProps {
  size?: number;
  label?: string;
}

export function Spinner({ size = 14, label }: SpinnerProps): JSX.Element {
  return (
    <span className="spinner-wrap" aria-busy>
      <span className="spinner" style={{ width: size, height: size }} />
      {label && <span className="spinner__label">{label}</span>}
    </span>
  );
}
