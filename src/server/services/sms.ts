import { AfricaTalkingSmsClient } from '@/server/integrations/africas-talking';
import { readStore, updateStore } from '@/server/store';

let client: AfricaTalkingSmsClient | null | undefined;

function getSmsClient() {
  if (client !== undefined) {
    return client;
  }

  const username = process.env.AFRICASTALKING_USERNAME;
  const apiKey = process.env.AFRICASTALKING_API_KEY;
  const baseUrl = process.env.AFRICASTALKING_BASE_URL;

  if (!username || !apiKey || !baseUrl || apiKey === 'replace-me') {
    client = null;
    return client;
  }

  client = new AfricaTalkingSmsClient({
    username,
    apiKey,
    baseUrl,
    senderId: process.env.AFRICASTALKING_SENDER_ID,
  });

  return client;
}

export function isSmsConfigured() {
  return Boolean(getSmsClient());
}

export async function dispatchSmsLogs(logIds: string[]) {
  const smsClient = getSmsClient();
  if (!smsClient || logIds.length === 0) {
    return {
      attempted: 0,
      delivered: 0,
      failed: 0,
      queuedOnly: logIds.length,
    };
  }

  const store = await readStore();
  const logs = store.smsLogs.filter((log) => logIds.includes(log.id) && log.status === 'queued');

  let delivered = 0;
  let failed = 0;

  for (const log of logs) {
    try {
      const response = await smsClient.sendSms({
        recipients: [log.recipientPhone],
        message: log.message,
        enqueue: true,
      });

      const recipient = response.recipients[0];
      const wasDelivered = Boolean(recipient) && Number(recipient.statusCode) < 500;

      await updateStore((current) => {
        const target = current.smsLogs.find((item) => item.id === log.id);
        if (!target) {
          return;
        }

        target.status = wasDelivered ? 'sent' : 'failed';
        target.sentAt = wasDelivered ? new Date().toISOString() : target.sentAt ?? null;
      });

      if (wasDelivered) {
        delivered += 1;
      } else {
        failed += 1;
      }
    } catch {
      await updateStore((current) => {
        const target = current.smsLogs.find((item) => item.id === log.id);
        if (!target) {
          return;
        }

        target.status = 'failed';
      });
      failed += 1;
    }
  }

  return {
    attempted: logs.length,
    delivered,
    failed,
    queuedOnly: 0,
  };
}
