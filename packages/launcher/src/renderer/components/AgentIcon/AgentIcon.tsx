import { useIconResolver } from '../../hooks/useIconResolver';

import './AgentIcon.css';

interface AgentIconProps {
  type: string;
  size?: number;
  className?: string;
}

export function AgentIcon({ type, size = 24, className }: AgentIconProps): JSX.Element {
  const { iconUrl } = useIconResolver();
  return (
    <img
      src={iconUrl(type)}
      alt={`${type} icon`}
      width={size}
      height={size}
      className={['agent-icon', className].filter(Boolean).join(' ')}
      onError={(e) => {
        // Fall through to a transparent square so layouts don't shift.
        (e.target as HTMLImageElement).style.visibility = 'hidden';
      }}
    />
  );
}
