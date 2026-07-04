import type { ReactNode } from 'react';

type SnapshotItem = {
  icon: ReactNode;
  label: string;
  value: string;
  trend?: { value: number; label: string };
};

type BusinessSnapshotProps = {
  items: SnapshotItem[];
};

export function BusinessSnapshot({ items }: BusinessSnapshotProps) {
  if (items.length === 0) {return null;}

  return (
    <div className="snapshot-grid">
      {items.map((item, i) => (
        <div key={i} className="snapshot-card">
          <div className="snapshot-card-header">
            <span className="snapshot-card-label">{item.label}</span>
            <span className="snapshot-card-icon">{item.icon}</span>
          </div>
          <div className="snapshot-card-value">{item.value}</div>
          {item.trend ? (
            <div className={`snapshot-card-trend ${item.trend.value > 0 ? 'trend-positive' : item.trend.value < 0 ? 'trend-negative' : 'trend-neutral'}`}>
              {item.trend.value > 0 ? '▲' : item.trend.value < 0 ? '▼' : '◆'}
              {' '}{item.trend.label}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
