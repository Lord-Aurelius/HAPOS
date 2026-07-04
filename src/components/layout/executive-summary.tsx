import { Sparkles, TrendingUp, Users, DollarSign, Activity, Lightbulb } from 'lucide-react';

type SummaryLine = {
  icon?: 'positive' | 'negative' | 'neutral';
  text: string;
};

type ExecutiveSummaryProps = {
  lines: SummaryLine[];
  dateLabel?: string;
  recommendedAction?: string;
};

const iconMap = {
  positive: TrendingUp,
  negative: DollarSign,
  neutral: Activity,
};

export function ExecutiveSummary({ lines, dateLabel, recommendedAction }: ExecutiveSummaryProps) {
  if (lines.length === 0) {return null;}

  return (
    <div className="executive-summary">
      <div className="executive-summary-header">
        <div className="executive-summary-title">
          <Sparkles />
          <span>Executive summary</span>
        </div>
        {dateLabel ? <span className="executive-summary-date">{dateLabel}</span> : null}
      </div>

      <div className="executive-summary-body">
        {lines.map((line, i) => {
          const Icon = iconMap[line.icon || 'neutral'];
          return (
            <div key={i} className={`executive-summary-item is-${line.icon || 'neutral'}`}>
              <Icon />
              <span>{line.text}</span>
            </div>
          );
        })}
      </div>

      {recommendedAction ? (
        <div className="executive-summary-action">
          <Lightbulb />
          <span><strong>Recommended action:</strong> {recommendedAction}</span>
        </div>
      ) : null}
    </div>
  );
}
