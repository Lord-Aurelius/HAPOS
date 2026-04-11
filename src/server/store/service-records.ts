import type { StoreServiceRecord, StoreState } from '@/server/store/types';

export function isServiceRecordVoided(record: Pick<StoreServiceRecord, 'voidedAt'>) {
  return Boolean(record.voidedAt);
}

export function isActiveServiceRecord(record: Pick<StoreServiceRecord, 'voidedAt'>) {
  return !isServiceRecordVoided(record);
}

export function voidServiceRecord(
  store: StoreState,
  input: { tenantId: string; recordId: string; userId: string; reason?: string | null },
) {
  const record = store.serviceRecords.find(
    (item) => item.id === input.recordId && item.tenantId === input.tenantId,
  );

  if (!record || isServiceRecordVoided(record)) {
    return { status: 'missing' as const, nextRecordId: null, restoredOrderId: null };
  }

  const now = new Date().toISOString();
  record.voidedAt = now;
  record.voidedBy = input.userId;
  record.voidReason = input.reason?.trim() || 'Sale removed from the ledger.';

  const linkedOrder = store.customerOrders.find(
    (order) => order.tenantId === input.tenantId && order.approvedRecordId === record.id,
  );

  if (linkedOrder && linkedOrder.status === 'approved') {
    linkedOrder.status = 'acknowledged';
    linkedOrder.statusUpdatedAt = now;
    linkedOrder.approvedAt = null;
    linkedOrder.approvedBy = null;
    linkedOrder.approvedRecordId = null;
  }

  const nextRecordId =
    store.serviceRecords
      .filter((item) => item.tenantId === input.tenantId && item.id !== record.id)
      .filter(isActiveServiceRecord)
      .sort((a, b) => b.performedAt.localeCompare(a.performedAt))[0]?.id ?? null;

  return {
    status: 'voided' as const,
    nextRecordId,
    restoredOrderId: linkedOrder?.id ?? null,
  };
}
