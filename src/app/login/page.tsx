import { HaposLogo } from '@/components/branding/hapos-logo';
import { loginAction } from '@/server/actions/hapos';

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;

  return (
    <main className="login-shell">
      <section className="login-poster">
        <div>
          <HaposLogo className="poster-logo" />
          <p className="hero-kicker">House Aurelius Point of Sale</p>
          <h1 className="hero-title">One platform for every chair, station, and shop.</h1>
          <p className="hero-subtitle login-poster-copy">
            Multi-tenant service tracking for barbershops and salons with revenue visibility, commission control, customer history, and automated follow-up messaging.
          </p>
        </div>

        <div>
          <div className="tenant-strip">
            <span className="tenant-chip">Strict tenant isolation</span>
            <span className="tenant-chip">Africa&apos;s Talking SMS</span>
            <span className="tenant-chip">Commission engine</span>
          </div>
        </div>
      </section>

      <section className="login-form">
        <div className="login-card">
          <p className="hero-kicker">Secure login</p>
          <h2 className="section-title">Sign into your business</h2>
          <p className="muted">
            Every employee logs into their own shop with a tenant slug plus unique username and password. Platform-level access is handled through an internal super-admin workspace.
          </p>

          {params.error ? (
            <p className="pill" style={{ marginTop: 18, background: 'rgba(160, 60, 46, 0.12)', color: 'var(--danger)' }}>
              Invalid business slug, username, or password.
            </p>
          ) : null}

          <form action={loginAction} className="field-grid" style={{ marginTop: 24 }}>
            <div className="field">
              <label htmlFor="businessSlug">Business slug</label>
              <input id="businessSlug" name="businessSlug" placeholder="your-business-slug" autoComplete="organization" />
              <span className="field-hint">Use the slug your business admin gave you. HAPOS does not expose shop names here.</span>
            </div>
            <div className="field">
              <label htmlFor="username">Username</label>
              <input id="username" name="username" placeholder="your username" />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" name="password" type="password" placeholder="your password" />
            </div>
            <div className="hero-actions">
              <button type="submit" className="button">
                Login
              </button>
              <a href="/customer/login" className="button secondary">
                Customer portal
              </a>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
