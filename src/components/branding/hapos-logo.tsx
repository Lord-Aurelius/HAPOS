type HaposLogoProps = {
  letters?: string;
  subtitle?: string;
  className?: string;
  compact?: boolean;
};

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function HaposLogo({
  letters = 'HAPOS',
  subtitle = 'House Aurelius Point of Sale',
  className,
  compact = false,
}: HaposLogoProps) {
  const monogram = letters.trim().charAt(0).toUpperCase() || 'H';

  return (
    <div className={classNames('hapos-logo', compact && 'is-compact', className)}>
      <span className="hapos-logo-mark" aria-hidden="true">
        <span>{monogram}</span>
      </span>
      <span className="hapos-logo-type">
        <strong>{letters}</strong>
        <small>{subtitle}</small>
      </span>
    </div>
  );
}
