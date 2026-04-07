'use client';

import { startTransition, useState } from 'react';
import { useRouter } from 'next/navigation';

type AddCustomerFormProps = {
  redirectPath?: string;
};

export function AddCustomerForm({ redirectPath = '/app/customers' }: AddCustomerFormProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/customers', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name,
          phone,
          phoneE164: phone,
          notes,
          marketingOptIn,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? 'Customer could not be added.');
        setSaving(false);
        return;
      }

      startTransition(() => {
        router.push(`${redirectPath}?success=customer-added`);
        router.refresh();
      });
    } catch {
      setError('Customer could not be added.');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="field-grid" style={{ marginBottom: 20 }}>
      <div className="field">
        <label htmlFor="newCustomerName">New customer name</label>
        <input
          id="newCustomerName"
          name="name"
          placeholder="Jane Wanjiku"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="newCustomerPhone">Phone in +254 format</label>
        <input
          id="newCustomerPhone"
          name="phone"
          placeholder="+254711000101"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="newCustomerNotes">Notes</label>
        <textarea
          id="newCustomerNotes"
          name="notes"
          placeholder="Prefers weekend appointments"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
      <label className="eyebrow" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          name="marketingOptIn"
          checked={marketingOptIn}
          onChange={(event) => setMarketingOptIn(event.target.checked)}
          style={{ width: 18, minHeight: 18 }}
        />
        Receive promotions
      </label>
      <div className="hero-actions" style={{ marginTop: 0 }}>
        <button type="submit" className="button" disabled={saving}>
          {saving ? 'Adding...' : 'Add customer'}
        </button>
      </div>
      {error ? (
        <span className="pill" style={{ background: 'rgba(160, 60, 46, 0.12)', color: 'var(--danger)' }}>
          {error}
        </span>
      ) : null}
    </form>
  );
}
