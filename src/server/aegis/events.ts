/**
 * AEGIS event log. State transitions worth transmitting (order submitted /
 * approved / rejected, expense created, advert created) are appended here
 * post-commit by canonical services — best-effort, never allowed to fail the
 * underlying operation. The log is a capped ring buffer inside the JSON
 * runtime store (no relational DDL), consumed by cursor poll
 * (`platform.events.since`) and tailed by the SSE endpoint.
 */

import { randomUUID } from 'node:crypto';

import { readStore, updateStore } from '@/server/store';

export const AI_EVENTS_VERSION = 1;
const AI_EVENTS_CAP = 200;

export type AiEventRecord = {
  id: string;
  tenantId: string;
  shopId: string;
  event: string;
  version: number;
  entityType: string | null;
  entityId: string | null;
  occurredAt: string;
  actorId: string | null;
  summary: string | null;
};

/** Append an event. Best-effort: persistence failures resolve to null. */
export async function recordAiEvent(input: {
  tenantId: string;
  event: string;
  entityType?: string | null;
  entityId?: string | null;
  actorId?: string | null;
  summary?: string | null;
}): Promise<AiEventRecord | null> {
  try {
    const occurredAt = new Date().toISOString();
    return await updateStore((store) => {
      const record: AiEventRecord = {
        id: randomUUID(),
        tenantId: input.tenantId,
        shopId: input.tenantId,
        event: input.event,
        version: AI_EVENTS_VERSION,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        occurredAt,
        actorId: input.actorId ?? null,
        summary: input.summary ?? null,
      };
      const log = ((store as { aiEvents?: AiEventRecord[] }).aiEvents ??= []);
      log.push(record);
      if (log.length > AI_EVENTS_CAP) {
        log.splice(0, log.length - AI_EVENTS_CAP);
      }
      return record;
    });
  } catch {
    return null;
  }
}

export async function listAiEvents(
  tenantId: string,
  options: { cursor?: string | null; entityType?: string | null; limit?: number } = {},
): Promise<{ events: AiEventRecord[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const store = await readStore();
  const log = ((store as unknown as { aiEvents?: AiEventRecord[] }).aiEvents ?? []).filter(
    (item) => item.tenantId === tenantId && (!options.entityType || item.entityType === options.entityType),
  );
  const start = options.cursor ? log.findIndex((item) => item.id === options.cursor) + 1 : 0;
  const events = log.slice(Math.max(start, 0), Math.max(start, 0) + limit);
  return { events, nextCursor: events.length > 0 ? events[events.length - 1].id : (options.cursor ?? null) };
}
