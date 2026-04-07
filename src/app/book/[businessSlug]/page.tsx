import Link from 'next/link';
import { notFound } from 'next/navigation';

import { HaposLogo } from '@/components/branding/hapos-logo';
import { formatCurrency } from '@/lib/format';
import { submitCustomerOrderAction } from '@/server/actions/hapos';
import { getTenantBookingContext } from '@/server/services/app-data';

export const dynamic = 'force-dynamic';

type CustomerBookingPageProps = {
  params: Promise<{ businessSlug: string }>;
  searchParams: Promise<{ success?: string; error?: string; phone?: string }>;
};

function getFeedbackMessage(error?: string, success?: string) {
  if (success === 'queued') {
    return 'Your request has been sent to the shop. Use the same phone number to open the customer portal and track your history.';
  }

  if (error === 'missing-fields') {
    return 'Enter your name, phone number, and service before sending the request.';
  }

  if (error === 'service-not-found') {
    return 'That service is no longer available for this business. Refresh and choose another service.';
  }

  if (error === 'staff-not-found') {
    return 'That staff member is no longer available. Choose another option or use no preference.';
  }

  if (error === 'blocked') {
    return 'This business is currently unavailable for customer requests.';
  }

  return null;
}

export default async function CustomerBookingPage({ params, searchParams }: CustomerBookingPageProps) {
  const { businessSlug } = await params;
  const pageParams = await searchParams;
  const context = await getTenantBookingContext(businessSlug);

  if (!context.tenant) {
    notFound();
  }

  const loyaltyProgram = context.tenant.loyaltyProgram;
  const feedbackMessage = getFeedbackMessage(pageParams.error, pageParams.success);
  const formBlocked = context.accessState.blocked || context.services.length === 0;

  return (
    <main className="login-shell">
      <section className="login-poster">
        <div>
          <HaposLogo className="poster-logo" />
          <p className="hero-kicker">Customer booking link</p>
          <h1 className="hero-title">{context.tenant.name}</h1>
          <p className="hero-subtitle" style={{ color: 'rgba(255, 233, 213, 0.82)' }}>
            Choose your exact service, leave the phone number you will later use for portal login, and tell the shop who you would like to serve you.
          </p>
        </div>

        <div className="tenant-strip">
          <span className="tenant-chip">{context.tenant.slug}</span>
          <span className="tenant-chip">{context.tenant.storeNumber || 'Customer requests enabled'}</span>
          <span className="tenant-chip">{context.tenant.address || 'Phone-based customer history'}</span>
        </div>

        {loyaltyProgram?.isEnabled ? (
          <div className="panel" style={{ marginTop: 20, background: 'rgba(255,255,255,0.08)' }}>
            <h3 style={{ marginTop: 0, color: 'white' }}>Current loyalty offer</h3>
            <p className="panel-copy" style={{ color: 'rgba(255, 233, 213, 0.82)' }}>
              Spend {formatCurrency(loyaltyProgram.spendThreshold, context.tenant.currencyCode)} and unlock{' '}
              {loyaltyProgram.rewardType === 'subsidized_service'
                ? loyaltyProgram.rewardLabel || `${formatCurrency(loyaltyProgram.rewardValue, context.tenant.currencyCode)} off your next service`
                : loyaltyProgram.rewardLabel || 'a complimentary service'}.
            </p>
          </div>
        ) : null}
      </section>

      <section className="login-form">
        <div className="login-card">
          <p className="hero-kicker">Request your next visit</p>
          <h2 className="section-title">Tell the business what you want</h2>
          <p className="muted">
            The staff team will see this request inside their counter workspace, and your phone number will attach future visits to your customer profile.
          </p>

          {feedbackMessage ? (
            <p
              className="pill"
              style={{
                marginTop: 18,
                background: pageParams.error ? 'rgba(160, 60, 46, 0.12)' : undefined,
                color: pageParams.error ? 'var(--danger)' : undefined,
              }}
            >
              {feedbackMessage}
            </p>
          ) : null}

          {context.accessState.blocked ? (
            <div className="panel" style={{ marginTop: 20 }}>
              <h3 style={{ marginTop: 0 }}>Requests are paused</h3>
              <p className="panel-copy">{context.accessState.message}</p>
            </div>
          ) : null}

          {context.services.length === 0 ? (
            <div className="panel" style={{ marginTop: 20 }}>
              <h3 style={{ marginTop: 0 }}>No services published yet</h3>
              <p className="panel-copy">This business has not published its customer-facing price list yet.</p>
            </div>
          ) : null}

          <form action={submitCustomerOrderAction} className="field-grid" style={{ marginTop: 24 }}>
            <input type="hidden" name="businessSlug" value={context.tenant.slug} />
            <div className="field">
              <label htmlFor="customerName">Your name</label>
              <input id="customerName" name="customerName" placeholder="Kevin Mwangi" required disabled={formBlocked} />
            </div>
            <div className="field">
              <label htmlFor="customerPhone">Phone number</label>
              <input
                id="customerPhone"
                name="customerPhone"
                placeholder="+254711000101"
                defaultValue={pageParams.phone ?? ''}
                required
                disabled={formBlocked}
              />
            </div>
            <div className="field">
              <label htmlFor="serviceId">Service</label>
              <select id="serviceId" name="serviceId" defaultValue={context.services[0]?.id ?? ''} disabled={formBlocked}>
                {context.services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} / {formatCurrency(service.price, context.tenant.currencyCode)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="requestedStaffId">Preferred staff member</label>
              <select id="requestedStaffId" name="requestedStaffId" defaultValue="" disabled={formBlocked}>
                <option value="">No preference</option>
                {context.staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="notes">Request notes</label>
              <textarea
                id="notes"
                name="notes"
                placeholder="Preferred time, style note, or anything the shop should prepare."
                disabled={formBlocked}
              />
            </div>
            <div className="hero-actions">
              <button type="submit" className="button" disabled={formBlocked}>
                Send request
              </button>
              <Link href="/customer/login" className="button secondary">
                Customer portal login
              </Link>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
