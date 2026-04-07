import Link from 'next/link';

import { HaposLogo } from '@/components/branding/hapos-logo';

export default function HomePage() {
  return (
    <main className="workspace">
      <section className="hero">
        <HaposLogo />
        <p className="hero-kicker">House Aurelius Point of Sale</p>
        <h1 className="hero-title">HAPOS keeps every shop in its own lane.</h1>
        <p className="hero-subtitle">
          Fast staff service entry, locked-down price lists, tenant-isolated reporting, commission tracking, subscription controls, and Africa&apos;s Talking SMS flows in one cloud-ready workspace.
        </p>
        <div className="hero-actions">
          <Link href="/login" className="button">
            Go to login
          </Link>
          <Link href="/customer/login" className="button secondary">
            Customer portal
          </Link>
        </div>
      </section>
    </main>
  );
}
