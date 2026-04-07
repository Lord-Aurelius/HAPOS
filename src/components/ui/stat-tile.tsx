type StatTileProps = {
  label: string;
  value: string;
  tone?: 'default' | 'success';
};

export function StatTile({ label, value, tone = 'default' }: StatTileProps) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <div className="tile-value" style={{ color: tone === 'success' ? 'var(--success)' : undefined }}>
        {value}
      </div>
    </div>
  );
}
