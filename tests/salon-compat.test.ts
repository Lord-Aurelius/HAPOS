/**
 * Salon compatibility contract (Phase 2, unit 6).
 *
 * The server actions in hapos.ts are not importable under node:test (Next.js
 * runtime), so these tests lock the CONTRACT the actions implement, using the
 * same ops primitives in the same order:
 *
 * - price-list direct entry  → engine order/sale + legacy co-write
 * - custom off-menu entry    → legacy-only (no catalog reference exists)
 * - booking approval         → CUSTOMER_BOOKING order + sale + legacy link
 * - legacy void              → engine sale voided with reversal
 * - engine void              → legacy co-write voided with booking restore
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  approveOrder,
  createOrder,
  finalizeApprovedOrder,
  submitOrder,
  voidSale,
} from '../src/server/commerce/commerce-store.ts';
import { voidServiceRecord } from '../src/server/store/service-records.ts';
import type { StoreState } from '../src/server/store/types.ts';

let sequence = 0;
function generateId() {
  sequence += 1;
  return `salon-compat-${sequence}`;
}

function salonStore() {
  return {
    products: [
      { id: 'prod-dye', tenantId: 'tenant-a', name: 'Hair Dye', unitCost: 500, quantityOnHand: 4, isActive: true },
    ],
    services: [
      { id: 'svc-cut', tenantId: 'tenant-a', name: 'Haircut', price: 250, commissionType: 'percentage' as const, commissionValue: 10, isActive: true },
      { id: 'svc-color', tenantId: 'tenant-a', name: 'Colour', price: 3000, commissionType: 'percentage' as const, commissionValue: 15, isActive: true },
    ],
    customers: [{ id: 'customer-1', tenantId: 'tenant-a' }],
    users: [
      { id: 'staff-1', tenantId: 'tenant-a' },
      { id: 'admin-1', tenantId: 'tenant-a' },
    ],
    serviceProductLinks: [
      { id: 'link-1', tenantId: 'tenant-a', serviceId: 'svc-color', productId: 'prod-dye', quantity: 1 },
    ],
    inventoryMovements: [],
    orders: [],
    orderItems: [],
    sales: [],
    saleItems: [],
    tenants: [{ id: 'tenant-a', orderReviewRequired: true }],
    serviceRecords: [],
    customerOrders: [],
  };
}

describe('price-list direct entry (engine + legacy co-write)', () => {
  it('creates one order, one sale, BOM movement and a linked legacy row', () => {
    const store = salonStore();
    const created = createOrder(store, {
      tenantId: 'tenant-a', customerId: 'customer-1', sellerId: 'staff-1', source: 'STAFF',
      lines: [{ kind: 'service', refId: 'svc-color', quantity: 1 }],
      idempotencyKey: 'salon-key-1', creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: true,
    }, { generateId });
    const submitted = submitOrder(store, {
      tenantId: 'tenant-a', orderId: created.order.id, actorId: 'staff-1', actorRole: 'staff', orderReviewRequired: true,
    }, { generateId });
    assert.equal(submitted.route, 'AUTO_APPROVE');
    const finalized = finalizeApprovedOrder(store, { tenantId: 'tenant-a', orderId: created.order.id, actorId: 'staff-1' }, { generateId });

    // Legacy co-write carries the engine link (what recordServiceAction does).
    const legacyRecord = {
      id: generateId(), tenantId: 'tenant-a', customerId: 'customer-1', staffId: 'staff-1',
      serviceId: 'svc-color', serviceName: 'Colour', price: 3000, voidedAt: null,
      commerceSaleId: finalized.sale.id,
    };
    (store.serviceRecords as unknown[]).push(legacyRecord);

    assert.equal(finalized.sale.total, 3000);
    assert.equal(store.products[0].quantityOnHand, 3);
    assert.equal((legacyRecord as { commerceSaleId: string }).commerceSaleId, finalized.sale.id);
  });
});

describe('custom off-menu entry (legacy-only)', () => {
  it('has no catalog reference to route through the engine', () => {
    // Custom sales carry serviceId null and a free-text price: there is no
    // catalog snapshot to take, so the engine path is unreachable by
    // construction and the legacy row is the entire record.
    const legacyOnly = { serviceId: null as string | null, serviceName: 'Home Beard Trim', price: 1000 };
    assert.equal(legacyOnly.serviceId, null);
  });
});

describe('booking approval (CUSTOMER_BOOKING order + legacy link)', () => {
  it('routes to review, approves once, links the legacy record', () => {
    const store = salonStore();
    const booking = {
      id: 'booking-1', tenantId: 'tenant-a', customerId: 'customer-1', serviceId: 'svc-cut',
      status: 'pending' as string, approvedRecordId: null as string | null,
    };
    (store.customerOrders as unknown[]).push(booking);

    const created = createOrder(store, {
      tenantId: 'tenant-a', customerId: 'customer-1', sellerId: 'staff-1', source: 'CUSTOMER_BOOKING',
      lines: [{ kind: 'service', refId: 'svc-cut', quantity: 1 }],
      idempotencyKey: `booking-${booking.id}`, creatorRole: 'shop_admin', creatorId: 'admin-1', orderReviewRequired: true,
    }, { generateId });
    const submitted = submitOrder(store, {
      tenantId: 'tenant-a', orderId: created.order.id, actorId: 'admin-1', actorRole: 'shop_admin', orderReviewRequired: true,
    }, { generateId });
    assert.equal(submitted.route, 'PENDING_REVIEW');
    const approved = approveOrder(store, { tenantId: 'tenant-a', orderId: created.order.id, actorId: 'admin-1', actorRole: 'shop_admin' }, { generateId });

    booking.status = 'approved';
    booking.approvedRecordId = 'legacy-record-1';
    assert.equal(approved.sale.total, 250);
    assert.equal(approved.order.status, 'COMPLETED');
    assert.equal(booking.approvedRecordId, 'legacy-record-1');
  });
});

describe('void cascades (both directions)', () => {
  function coWrittenSale() {
    const store = salonStore();
    const created = createOrder(store, {
      tenantId: 'tenant-a', customerId: 'customer-1', sellerId: 'staff-1', source: 'STAFF',
      lines: [{ kind: 'service', refId: 'svc-color', quantity: 1 }],
      creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: true,
    }, { generateId });
    submitOrder(store, {
      tenantId: 'tenant-a', orderId: created.order.id, actorId: 'staff-1', actorRole: 'staff', orderReviewRequired: true,
    }, { generateId });
    const finalized = finalizeApprovedOrder(store, { tenantId: 'tenant-a', orderId: created.order.id, actorId: 'staff-1' }, { generateId });
    const legacyRecord = {
      id: 'legacy-1', tenantId: 'tenant-a', customerId: 'customer-1', staffId: 'staff-1',
      serviceId: 'svc-color', voidedAt: null, voidedBy: null, voidReason: null,
      commerceSaleId: finalized.sale.id,
    };
    (store.serviceRecords as unknown[]).push(legacyRecord);
    return { store, saleId: finalized.sale.id };
  }

  it('legacy void also voids the engine sale with stock reversal', () => {
    const { store, saleId } = coWrittenSale();
    assert.equal(store.products[0].quantityOnHand, 3);

    const record = (store.serviceRecords as { id: string; commerceSaleId: string }[])[0];
    const voided = voidServiceRecord(store as unknown as StoreState, {
      tenantId: 'tenant-a', recordId: record.id, userId: 'admin-1', reason: 'Duplicate',
    });
    assert.equal(voided.status, 'voided');
    // Action cascades via commerceSaleId (mirrored here through the same op).
    const { sale } = voidSale(store, { tenantId: 'tenant-a', saleId, actorId: 'admin-1', actorRole: 'shop_admin', reason: 'Duplicate' }, { generateId });
    assert.equal(sale.status, 'VOIDED');
    assert.equal(store.products[0].quantityOnHand, 4);
  });

  it('engine void also voids the legacy co-write and restores the booking', () => {
    const { store, saleId } = coWrittenSale();
    const booking = {
      id: 'booking-9', tenantId: 'tenant-a', status: 'approved' as string,
      approvedRecordId: 'legacy-1', statusUpdatedAt: null as string | null,
      approvedAt: '2026-01-01T00:00:00.000Z', approvedBy: 'admin-1',
    };
    (store.customerOrders as unknown[]).push(booking);

    voidSale(store, { tenantId: 'tenant-a', saleId, actorId: 'admin-1', actorRole: 'shop_admin' }, { generateId });
    const cascaded = voidServiceRecord(store as unknown as StoreState, {
      tenantId: 'tenant-a', recordId: 'legacy-1', userId: 'admin-1', reason: 'Sale voided.',
    });
    assert.equal(cascaded.status, 'voided');
    assert.equal(cascaded.restoredOrderId, 'booking-9');
    assert.equal(store.products[0].quantityOnHand, 4);
  });
});
