import { Card } from '../../components';
import { formatTimestamp } from '../../lib/format';
import { useUiStore } from '../../store/uiStore';

export function ActivityLog(): JSX.Element {
  const activity = useUiStore((s) => s.activity);

  return (
    <Card title="Activity" className="activity-log-card">
      {activity.length === 0 ? (
        <div className="activity-log__empty">No activity yet.</div>
      ) : (
        <ul className="activity-log">
          {activity.map((entry) => (
            <li key={entry.id} className={`activity-log__item activity-log__item--${entry.kind}`}>
              <span className="activity-log__time">{formatTimestamp(entry.timestamp)}</span>
              <span className="activity-log__text">{entry.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
