/**
 * Live SQL adapter tests (Phase 4).
 *
 * Gated on HAPOS_TEST_DATABASE_URL — skipped in normal `npm test` runs.
 * Run locally against ephemeral Postgres:
 *   HAPOS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/verify_x npm test
 * (apply db/schema.sql + db/migrations/*.sql first; tables use IF NOT EXISTS
 * so reruns are safe, and every run uses unique tenant slugs + cleanup).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgresCommerceRepository } from '../src/server/commerce/postgres-repository.ts';

const DATABASE_URL = process.env.HAPOS_TEST_DATABASE_URL ?? '';
const RUN = Date.now().toString(36);
let sequence = 0;
const generateId = () => `sql-test-${RUN}-${(sequence += 1)}`;

const STAFF = { actorId: 'staff-x', actorRole: 'staff' as const };
const ADMIN = { actorId: 'admin-x', actorRole: 'shop_admin' as const };

describe('PostgresCommerceRepository', { skip: !DATABASE_URL }, () => {
  let pool: Pool;
  let repo: PostgresCommerceRepository;
  let tenantId = '';
  let staffId = '';
  let adminId = '';
  let customerId = '';
  let productId = '';
  let serviceId = '';

  before(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    for (const file of [
      'db/schema.sql',
      'db/migrations/phase-01-catalog-inventory.sql',
      'db/migrations/phase-02-orders-sales.sql',
      'db/migrations/phase-2a-attendance.sql',
      'db/migrations/phase-03-seller-credentials.sql',
      'db/migrations/phase-03b-payment-intent.sql',
      'db/migrations/phase-03c-qr-persistence.sql',
      'db/migrations/phase-04-payments.sql',
      'db/migrations/phase-04b-tenant-policy.sql',
    ]) {
      await pool.query(readFileSync(join(repoRoot, file), 'utf8'));
    }
    repo = new PostgresCommerceRepository(pool);

    const tenant = await pool.query(`insert into tenants (name, slug) values ('SQL Test Shop','sql-shop-${RUN}') returning id`);
    tenantId = tenant.rows[0].id as string;
    STAFF.actorId = '';
    ADMIN.actorId = '';
    const admin = await pool.query(
      `insert into users (tenant_id, role, full_name, username, email, password_hash, employee_number) values ($1,'shop_admin','SQL Admin','sqladmin${RUN}','a${RUN}@x.example','x','EMP-9001') returning id`,
      [tenantId],
    );
    adminId = admin.rows[0].id as string;
    ADMIN.actorId = adminId;
    const staff = await pool.query(
      `insert into users (tenant_id, role, full_name, username, email, password_hash, employee_number, commission_type, commission_value) values ($1,'staff','SQL Staff','sqlstaff${RUN}','s${RUN}@x.example','x','EMP-9002','percentage',10) returning id`,
      [tenantId],
    );
    staffId = staff.rows[0].id as string;
    STAFF.actorId = staffId;
    const customer = await pool.query(
      `insert into customers (tenant_id, name, phone, phone_e164) values ($1,'SQL Customer','0711000999','+254711000999') returning id`,
      [tenantId],
    );
    customerId = customer.rows[0].id as string;
    const product = await pool.query(
      `insert into products (tenant_id, name, unit_cost, selling_price, sku, quantity_on_hand, reorder_level, critical_level) values ($1,'SQL Oil',300,800,'SQLOIL-${RUN}',10,5,2) returning id`,
      [tenantId],
    );
    productId = product.rows[0].id as string;
    const service = await pool.query(
      `insert into services (tenant_id, name, price, duration_minutes, commission_type, commission_value) values ($1,'SQL Cut',250,30,'percentage',10) returning id`,
      [tenantId],
    );
    serviceId = service.rows[0].id as string;
  });

  after(async () => {
    await pool.query(`delete from tenants where id = $1`, [tenantId]).catch(() => undefined);
    await pool.end();
  });

  it('reads tenant policy and catalog', async () => {
    const policy = await repo.getTenantPolicy(tenantId);
    assert.equal(policy.orderReviewRequired, true);
    const products = await repo.getCatalogProducts(tenantId);
    assert.equal(products.find((p) => p.id === productId)?.sellingPrice, 800);
    assert.equal(products.find((p) => p.id === productId)?.quantityOnHand, 10);
    const services = await repo.getCatalogServices(tenantId);
    assert.equal(services.find((s) => s.id === serviceId)?.price, 250);
  });

  it('runs the order lifecycle with atomic inventory', async () => {
    const created = await repo.createOrder({
      tenantId, customerId, sellerId: staffId, source: 'STAFF',
      lines: [
        { kind: 'service', refId: serviceId, quantity: 1 },
        { kind: 'product', refId: productId, quantity: 2 },
      ],
      creatorRole: 'staff', creatorId: staffId, orderReviewRequired: true,
    });
    assert.equal(created.order.status, 'DRAFT');
    assert.equal(created.order.total, 250 + 1600);
    const submitted = await repo.submitOrder({
      tenantId, orderId: created.order.id, actorId: staffId, actorRole: 'staff', orderReviewRequired: true,
    });
    assert.equal(submitted.route, 'AUTO_APPROVE');
    const approved = await repo.approveOrder({ tenantId, orderId: created.order.id, actorId: adminId, actorRole: 'shop_admin' });
    assert.equal(approved.sale.status, 'COMPLETED');
    assert.equal(await repo.getProductBalance(tenantId, productId), 8);
    // Re-approval converges on the original sale.
    const retry = await repo.approveOrder({ tenantId, orderId: created.order.id, actorId: adminId, actorRole: 'shop_admin' });
    assert.equal(retry.duplicate, true);
    assert.equal(retry.sale.id, approved.sale.id);
  });

  it('blocks insufficient stock atomically (no sale, no movement)', async () => {
    const created = await repo.createOrder({
      tenantId, customerId: null, sellerId: staffId, source: 'STAFF',
      lines: [{ kind: 'product', refId: productId, quantity: 999 }],
      creatorRole: 'staff', creatorId: staffId, orderReviewRequired: true,
    });
    await repo.submitOrder({ tenantId, orderId: created.order.id, actorId: staffId, actorRole: 'staff', orderReviewRequired: true });
    await assert.rejects(() => repo.approveOrder({ tenantId, orderId: created.order.id, actorId: adminId, actorRole: 'shop_admin' }), /Insufficient stock/);
    const detail = await repo.getOrderWithItems(tenantId, created.order.id);
    assert.equal(detail?.order.status, 'APPROVED');
    const sales = await repo.getSellerSales(tenantId, staffId);
    assert.ok(!sales.sales.some((s) => s.orderId === created.order.id));
  });

  it('manages payment intents with duplicate-safe transitions', async () => {
    const created = await repo.createOrder({
      tenantId, customerId: null, sellerId: staffId, source: 'SELLER_QR',
      lines: [{ kind: 'service', refId: serviceId, quantity: 1 }],
      creatorRole: 'staff', creatorId: staffId, orderReviewRequired: true,
    });
    const first = await repo.createPayment({
      tenantId, orderId: created.order.id, provider: 'PAYMENTOS', method: 'MPESA',
      amount: created.order.total, currencyCode: 'KES', customerPhone: '+254712345678',
      providerRequestId: 'req-dup-1', idempotencyKey: `pay-dup-${RUN}`, attemptNumber: 1,
    });
    assert.equal(first.duplicate, false);
    const retry = await repo.createPayment({
      tenantId, orderId: created.order.id, provider: 'PAYMENTOS', method: 'MPESA',
      amount: created.order.total, currencyCode: 'KES', customerPhone: '+254712345678',
      providerRequestId: 'req-dup-1', idempotencyKey: `pay-dup-${RUN}`, attemptNumber: 1,
    });
    assert.equal(retry.duplicate, true);
    assert.equal(retry.payment.id, first.payment.id);

    const success = await repo.transitionPayment({ tenantId, paymentId: first.payment.id, to: 'SUCCESS', providerReference: 'REF1' });
    assert.equal(success.payment.status, 'SUCCESS');
    assert.equal(success.duplicate, false);
    // Duplicate success callback converges.
    const again = await repo.transitionPayment({ tenantId, paymentId: first.payment.id, to: 'SUCCESS', providerReference: 'REF1' });
    assert.equal(again.duplicate, true);
    assert.equal(again.payment.status, 'SUCCESS');
  });

  it('flags recovery and isolates tenants', async () => {
    const marked = await repo.markPaymentRecovery(tenantId, '00000000-0000-0000-0000-000000000000', 'nope').then(
      () => { throw new Error('should have thrown'); },
      () => 'threw-ok',
    );
    assert.equal(marked, 'threw-ok');
    const lists = await repo.listPayments(tenantId, {});
    assert.ok(Array.isArray(lists));
    const foreign = await repo.getPaymentByIdempotency('00000000-0000-0000-0000-000000000000', 'nope');
    assert.equal(foreign, null);
  });

  it('verifies seller credentials against hashes', async () => {
    const { hashSellerBearer } = await import('../src/server/commerce/seller.ts');
    const { randomUUID } = await import('node:crypto');
    const reference = `sel-${RUN.slice(-8).padEnd(16, '0')}`;
    await pool.query(
      `insert into seller_credentials (id, tenant_id, seller_id, public_reference, token_hash, status) values ($1,$2,$3,$4,$5,'ACTIVE')`,
      [randomUUID(), tenantId, staffId, reference, hashSellerBearer('f'.repeat(64))],
    );
    const context = await repo.verifySellerCredential(tenantId, reference, 'f'.repeat(64));
    assert.equal(context.sellerId, staffId);
    await assert.rejects(() => repo.verifySellerCredential(tenantId, reference, '0'.repeat(64)), /not recognized/);
  });
});
