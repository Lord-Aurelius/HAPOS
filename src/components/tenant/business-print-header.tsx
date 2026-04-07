import type { Tenant } from '@/lib/types';

import { BusinessAvatar } from '@/components/tenant/business-avatar';

type BusinessPrintHeaderProps = {
  tenant: Tenant;
  title: string;
  subtitle?: string;
};

export function BusinessPrintHeader({ tenant, title, subtitle }: BusinessPrintHeaderProps) {
  return (
    <section className="print-header panel">
      <div className="print-header-top">
        <div className="print-header-brand">
          <BusinessAvatar tenant={tenant} size="lg" />
          <div>
            <p className="hero-kicker">Business identity</p>
            <h1 className="print-header-title">{tenant.name}</h1>
            <p className="print-header-motto">{tenant.motto || 'Professional service records, reports, and receipts.'}</p>
          </div>
        </div>
        <div className="print-header-meta">
          <div>
            <strong>Store number</strong>
            <div className="eyebrow">{tenant.storeNumber || 'Not set'}</div>
          </div>
          <div>
            <strong>Address</strong>
            <div className="eyebrow">{tenant.address || 'Not set'}</div>
          </div>
          <div>
            <strong>Business slug</strong>
            <div className="eyebrow">{tenant.slug}</div>
          </div>
        </div>
      </div>

      <div className="print-header-divider" />

      <div className="print-header-bottom">
        <div>
          <p className="hero-kicker">Document</p>
          <h2>{title}</h2>
        </div>
        {subtitle ? <p className="print-header-subtitle">{subtitle}</p> : null}
      </div>
    </section>
  );
}
