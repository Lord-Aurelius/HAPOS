import { queuePromotionAction } from '@/server/actions/hapos';
import { requireSession } from '@/server/auth/demo-session';
import { listCustomers, listSmsLogs } from '@/server/services/app-data';
import { isSmsConfigured } from '@/server/services/sms';

export default async function SmsPage() {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return null;
  }

  const [customers, smsLogs] = await Promise.all([
    listCustomers(session.tenant.id),
    listSmsLogs(session.tenant.id),
  ]);
  const promotionalAudience = customers.filter((customer) => customer.marketingOptIn).length;
  const liveSmsEnabled = isSmsConfigured();

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">SMS center</p>
        <h1 className="hero-title">Automate gratitude, send promotions deliberately.</h1>
        <p className="hero-subtitle">
          Thank-you messages are queued after each completed service, while promotional sends respect marketing consent and tenant boundaries.
        </p>
      </section>

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Promotion composer</h2>
              <p className="panel-copy">
                {liveSmsEnabled
                  ? "Promotion sends are dispatched through Africa's Talking and still logged per recipient."
                  : "Promotions are queued in-app now and will dispatch immediately once Africa's Talking credentials are added."}
              </p>
            </div>
            <span className="pill">{promotionalAudience} opt-in customers</span>
          </div>

          <form action={queuePromotionAction} className="field-grid">
            <div className="field">
              <label htmlFor="sms-message">Promotional message</label>
              <textarea
                id="sms-message"
                name="message"
                defaultValue="Weekend braid offer now live. Book today and enjoy a free trim consultation."
              />
            </div>
            <div className="hero-actions">
              <button type="submit" className="button">
                Queue promotion
              </button>
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Recent SMS log</h2>
              <p className="panel-copy">Provider message ids and error metadata belong here in the live system.</p>
            </div>
          </div>

          <div className="stack">
            {smsLogs.map((log) => (
              <div key={log.id} className="list-row">
                <div>
                  <strong>{log.recipientPhone}</strong>
                  <div className="eyebrow">{log.message}</div>
                </div>
                <span className="pill">{log.status}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
