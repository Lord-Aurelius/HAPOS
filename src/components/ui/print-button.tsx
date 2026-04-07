'use client';

type PrintButtonProps = {
  label?: string;
  className?: string;
};

export function PrintButton({ label = 'Print', className }: PrintButtonProps) {
  return (
    <button
      type="button"
      className={className ?? 'button secondary'}
      onClick={() => {
        window.print();
      }}
    >
      {label}
    </button>
  );
}
