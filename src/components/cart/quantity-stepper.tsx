'use client';

import { useState } from 'react';

type QuantityStepperProps = {
  fieldName: string;
  inputId: string;
  defaultValue?: number;
  label: string;
};

/**
 * Mobile-friendly quantity stepper ([−] 1 [+], min 1, whole numbers).
 * Submits under the same field name as the plain input it replaces, so
 * server parsing is unchanged. Server validation stays authoritative:
 * this control is convenience only.
 */
export function QuantityStepper({ fieldName, inputId, defaultValue = 1, label }: QuantityStepperProps) {
  const [value, setValue] = useState<number>(defaultValue);

  function clamp(next: number) {
    if (!Number.isFinite(next)) {
      return 1;
    }
    return Math.max(1, Math.floor(next));
  }

  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          className="button secondary"
          style={{ minHeight: 40, minWidth: 44 }}
          aria-label={`Decrease ${label}`}
          onClick={() => setValue((current) => clamp(current - 1))}
        >
          −
        </button>
        <input
          id={inputId}
          name={fieldName}
          type="number"
          min={1}
          step={1}
          value={value}
          onChange={(event) => setValue(clamp(Number(event.target.value)))}
          style={{ textAlign: 'center', maxWidth: 88 }}
        />
        <button
          type="button"
          className="button secondary"
          style={{ minHeight: 40, minWidth: 44 }}
          aria-label={`Increase ${label}`}
          onClick={() => setValue((current) => clamp(current + 1))}
        >
          +
        </button>
      </div>
    </div>
  );
}
