import Link from 'next/link';

import { HaposLogo } from '@/components/branding/hapos-logo';
import { customerLoginAction } from '@/server/actions/hapos';

type CustomerLoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

function getMessage(error?: string) {
  if (error === 'blocked') {
    return 'This shop is currently blocked because the tenant licence or business status needs attention.';
  }

  if (error === 'invalid') {
    return 'We could not find a customer record for that business slug and phone number.';
  }

  return null;
}

export default async function CustomerLoginPage({ searchParams }: CustomerLoginPageProps) {
  const params = await searchParams;

  return (
    <main className="login-shell">
      <section className="login-poster">
        <div>
          <HaposLogo className="poster-logo" />
          <p className="hero-kicker">Customer portal</p>
          <h1 className="hero-title">Track your visits, services, and offers in one place.</h1>
          <p className="hero-subtitle" style={{ color: 'rgba(255, 233, 213, 0.82)' }}>
            Customers can sign in with their shop slug and phone number to view visit count, service history, price list,
            and platinum marketplace offers.
          </p>
        </div>

        <div className="tenant-strip">
          <span className="tenant-chip">Visit history</span>
          <span className="tenant-chip">Staff history</span>
          <span className="tenant-chip">Marketplace access for platinum shops</span>
        </div>
      </section>

      <section className="login-form">
        <div className="login-card">
          <p className="hero-kicker">Secure customer access</p>
          <h2 className="section-title">Open your customer view</h2>
          <p className="muted">
            Use the business slug and the same phone number you used on the customer booking link or during your in-shop visits.
          </p>

          {getMessage(params.error) ? (
            <p className="pill" style={{ marginTop: 18, background: 'rgba(160, 60, 46, 0.12)', color: 'var(--danger)' }}>
              {getMessage(params.error)}
            </p>
          ) : null}

          <form action={customerLoginAction} className="field-grid" style={{ marginTop: 24 }}>
            <div className="field">
              <label htmlFor="businessSlug">Business slug</label>
              <input id="businessSlug" name="businessSlug" placeholder="royal-fades" required />
            </div>
            <div className="field">
              <label htmlFor="phone">Phone number</label>
              <input id="phone" name="phone" placeholder="+254711000101" required />
            </div>
            <div className="hero-actions">
              <button type="submit" className="button">
                Open customer portal
              </button>
              <Link href="/login" className="button secondary">
                Staff/admin login
              </Link>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
