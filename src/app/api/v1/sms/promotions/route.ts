import { apiAccepted } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { dispatchSmsLogs } from '@/server/services/sms';
import { updateStore } from '@/server/store';
import { randomUUID } from 'node:crypto';

export async function POST(request: Request) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiAccepted({ queuedRecipients: 0 });
  }
  const body = await request.json();
  const result = await updateStore((store) => {
    const customers = store.customers.filter(
      (customer) =>
        customer.tenantId === session.tenant!.id &&
        customer.marketingOptIn &&
        !customer.archivedAt,
    );
    const queuedIds: string[] = [];

    for (const customer of customers) {
      const smsId = randomUUID();
      store.smsLogs.push({
        id: smsId,
        tenantId: session.tenant!.id,
        customerId: customer.id,
        smsType: 'promotion',
        recipientPhone: customer.phoneE164,
        message: body.message,
        status: 'queued',
        createdAt: new Date().toISOString(),
      });
      queuedIds.push(smsId);
    }

    return { queuedRecipients: customers.length, queuedIds };
  });
  await dispatchSmsLogs(result.queuedIds);
  return apiAccepted({ queuedRecipients: result.queuedRecipients });
}
