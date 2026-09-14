/**
 * PostgreSQL commerce repository (Phase 4, authoritative production path).
 *
 * Real relational transactions with row-level locking:
 * - order approval/finalization locks product balance rows (FOR UPDATE, id
 *   order) before validating and posting sale + items + movements atomically,
 * - payment transitions use conditional UPDATE ... WHERE status='PENDING'
 *   so concurrent callbacks converge (one winner, rest read the outcome),
 * - idempotency pre-checks ride the same transactions; unique constraints
 *   are the final backstop.
 *
 * Business rules are NOT reimplemented here: catalog snapshots, lifecycle
 * transitions, commission math, movement validation and payment transitions
 * all call the same pure domain modules as the file adapter.
 *
 * Imports are limited to `pg`, pure domain modules and types, so this file
 * loads under `node --test` (live-database tests gate on
 * HAPOS_TEST_DATABASE_URL and skip otherwise).
 */

import type { Pool, PoolClient } from 'pg';
import { timingSafeEqual } from 'node:crypto';

import {
  CommerceError,
  assertClientTotal,
  buildOrderLines,
  routeNewOrder,
  transitionOrderStatus,
  type OrderSource,
} from './orders.ts';
import {
  InventoryError,
  applyMovement,
  planAdjustment,
  resolveServiceConsumption,
  type InventoryMovementType,
} from './inventory.ts';
import {
  PaymentError,
  transitionPaymentStatus,
  type PaymentMethod,
  type PaymentProvider,
  type PaymentStatus,
} from './payments.ts';
import { SellerError, hashSellerBearer } from './seller.ts';
import { PaymentConnectionError } from '../payments/connection.ts';
import type {
  OpsPaymentConnection,
  PaymentConnectionEnvironment,
  PaymentConnectionMethod,
  PaymentConnectionProvider,
  PaymentConnectionStatus,
} from '../payments/connection.ts';
import type {
  CommerceRepository,
  CreateOrderInput,
  CreatePaymentInput,
  OpContext,
  OpsCatalogProduct,
  OpsCatalogService,
  OpsMovement,
  OpsOrder,
  OpsOrderItem,
  OpsPayment,
  OpsSale,
  OpsSaleItem,
  OpsSellerContext,
  OpsTenantPolicy,
  PostMovementInput,
  TransitionPaymentInput,
} from './repository.ts';
import type {
  Order as OrderView,
  OrderItem as OrderItemView,
  Sale as SaleView,
  SaleItem as SaleItemView,
} from '@/lib/types';
import type { ActorRole } from './commerce-store.ts';

function nowISO(ctx: OpContext): string {
  return ctx.now ?? new Date().toISOString();
}

function newId(ctx: OpContext): string {
  if (ctx.generateId) {
    return ctx.generateId();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function toISO(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
};

async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      /* rollback best-effort */
    }
    throw error;
  } finally {
    client.release();
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

export class PostgresCommerceRepository implements CommerceRepository {
  readonly backend = 'sql' as const;

  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  // ── catalog / policy ──

  async getTenantPolicy(tenantId: string): Promise<OpsTenantPolicy> {
    const { rows } = await this.pool.query(
      `select slug, name, timezone, currency_code, order_review_required from tenants where id = $1`,
      [tenantId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      throw new CommerceError('unknown-item', 'Shop not found.');
    }
    return {
      orderReviewRequired: (row.order_review_required as boolean | null) ?? true,
      timezone: (row.timezone as string | null) || 'UTC',
      currencyCode: (row.currency_code as string | null) || 'KES',
      slug: row.slug as string,
      name: row.name as string,
    };
  }

  async getCatalogProducts(tenantId: string): Promise<OpsCatalogProduct[]> {
    const { rows } = await this.pool.query(
      `select id, tenant_id, name, selling_price, unit_cost, sku, quantity_on_hand, reorder_level, critical_level, is_active
       from products where tenant_id = $1 order by name`,
      [tenantId],
    );
    return rows.map((row) => ({
      id: row.id as string,
      tenantId: row.tenant_id as string,
      name: row.name as string,
      sellingPrice: row.selling_price === null ? null : toNumber(row.selling_price),
      unitCost: toNumber(row.unit_cost),
      sku: (row.sku as string | null) ?? null,
      quantityOnHand: Number(row.quantity_on_hand),
      reorderLevel: row.reorder_level === null ? null : Number(row.reorder_level),
      criticalLevel: row.critical_level === null ? null : Number(row.critical_level),
      isActive: row.is_active as boolean,
    }));
  }

  async getCatalogServices(tenantId: string): Promise<OpsCatalogService[]> {
    const { rows } = await this.pool.query(
      `select id, tenant_id, name, price, duration_minutes, commission_type, commission_value, is_active
       from services where tenant_id = $1 order by name`,
      [tenantId],
    );
    return rows.map((row) => ({
      id: row.id as string,
      tenantId: row.tenant_id as string,
      name: row.name as string,
      price: toNumber(row.price),
      durationMinutes: row.duration_minutes === null ? undefined : Number(row.duration_minutes),
      commissionType: row.commission_type as 'fixed' | 'percentage',
      commissionValue: toNumber(row.commission_value),
      isActive: row.is_active as boolean,
    }));
  }

  async getProductBalance(tenantId: string, productId: string): Promise<number> {
    const { rows } = await this.pool.query(
      `select quantity_on_hand from products where tenant_id = $1 and id = $2`,
      [tenantId, productId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      throw new CommerceError('unknown-item', 'Product not found for this shop.');
    }
    return Number(row.quantity_on_hand);
  }

  // ── orders ──

  private async catalogViews(client: DbClient, tenantId: string) {
    const products = await client.query(
      `select id, tenant_id, name, selling_price, unit_cost, sku, is_active from products where tenant_id = $1`,
      [tenantId],
    );
    const services = await client.query(
      `select id, tenant_id, name, price, duration_minutes, commission_type, commission_value, is_active from services where tenant_id = $1`,
      [tenantId],
    );
    return {
      products: products.rows.map((row) => ({
        id: row.id as string,
        tenantId: row.tenant_id as string,
        name: row.name as string,
        sellingPrice: row.selling_price === null ? null : toNumber(row.selling_price),
        unitCost: toNumber(row.unit_cost),
        sku: (row.sku as string | null) ?? null,
        isActive: row.is_active as boolean,
      })),
      services: services.rows.map((row) => ({
        id: row.id as string,
        tenantId: row.tenant_id as string,
        name: row.name as string,
        price: toNumber(row.price),
        durationMinutes: row.duration_minutes === null ? undefined : Number(row.duration_minutes),
        commissionType: row.commission_type as 'fixed' | 'percentage',
        commissionValue: toNumber(row.commission_value),
        isActive: row.is_active as boolean,
      })),
    };
  }

  private async staffTerms(client: DbClient, tenantId: string, sellerId: string | null) {
    if (!sellerId) {
      return null;
    }
    const { rows } = await client.query(
      `select commission_type, commission_value from users where tenant_id = $1 and id = $2`,
      [tenantId, sellerId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row || row.commission_type === null || row.commission_type === undefined) {
      return null;
    }
    return {
      commissionType: row.commission_type as 'fixed' | 'percentage',
      commissionValue: toNumber(row.commission_value ?? 0),
    };
  }

  async createOrder(input: CreateOrderInput, ctx: OpContext = {}) {
    return withTransaction(this.pool, async (client) => {
      if (input.idempotencyKey) {
        const existing = await client.query(
          `select id from orders where tenant_id = $1 and idempotency_key = $2`,
          [input.tenantId, input.idempotencyKey],
        );
        if (existing.rowCount) {
          const found = await this.readOrder(client, input.tenantId, (existing.rows[0] as Record<string, string>).id);
          return { ...found, duplicate: true };
        }
      }

      if (input.customerId) {
        const customer = await client.query(`select tenant_id from customers where id = $1`, [input.customerId]);
        const row = customer.rows[0] as Record<string, unknown> | undefined;
        if (!row) {
          throw new CommerceError('unknown-item', 'Customer not found for this shop.');
        }
        if (row.tenant_id !== input.tenantId) {
          throw new CommerceError('cross-tenant-item', 'That customer belongs to another shop.');
        }
      }

      if (input.sellerId) {
        const seller = await client.query(`select tenant_id from users where id = $1`, [input.sellerId]);
        const row = seller.rows[0] as Record<string, unknown> | undefined;
        if (!row || (row.tenant_id !== null && row.tenant_id !== input.tenantId)) {
          throw new CommerceError('unknown-item', 'Seller not found for this shop.');
        }
      }

      if (input.sellerCredentialId) {
        const credential = await client.query(
          `select tenant_id, seller_id, status from seller_credentials where id = $1`,
          [input.sellerCredentialId],
        );
        const row = credential.rows[0] as Record<string, unknown> | undefined;
        if (!row || row.tenant_id !== input.tenantId || row.seller_id !== (input.sellerId ?? '') || row.status !== 'ACTIVE') {
          throw new CommerceError('unknown-item', 'Seller credential not found for this shop.');
        }
      }

      const views = await this.catalogViews(client, input.tenantId);
      const staffCommission = await this.staffTerms(client, input.tenantId, input.sellerId ?? null);
      // Staff terms override service defaults (file-adapter parity).
      const cart = buildOrderLines({
        tenantId: input.tenantId,
        products: views.products,
        services: views.services,
        lines: input.lines,
        staffCommission,
      });
      assertClientTotal(cart.total, input.clientTotal);

      const now = nowISO(ctx);
      const orderId = newId(ctx);
      await client.query(
        `insert into orders (id, tenant_id, customer_id, seller_id, status, subtotal, total, currency_code, source, notes, idempotency_key, quoted_at, created_by, seller_credential_id, payment_method, customer_phone, created_at, updated_at)
         values ($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$11,$11)`,
        [
          orderId, input.tenantId, input.customerId ?? null, input.sellerId ?? null,
          cart.subtotal, cart.total, input.currencyCode ?? 'KES', input.source,
          input.notes ?? null, input.idempotencyKey ?? null, now, input.creatorId,
          (input as { sellerCredentialId?: string | null }).sellerCredentialId ?? null,
          (input as { paymentMethod?: string | null }).paymentMethod ?? null,
          (input as { customerPhone?: string | null }).customerPhone ?? null,
        ],
      );

      for (const line of cart.lines) {
        await client.query(
          `insert into order_items (id, tenant_id, order_id, item_type, product_id, service_id, quantity, catalog_unit_price, actual_unit_price, line_total, item_name, item_snapshot, commission_type, commission_value, commission_amount, override_reason, override_by, override_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [
            newId(ctx), input.tenantId, orderId, line.kind === 'product' ? 'PRODUCT' : 'SERVICE',
            line.productId, line.serviceId, line.quantity, line.catalogUnitPrice, line.actualUnitPrice,
            line.lineTotal, line.itemName, JSON.stringify(line.itemSnapshot),
            line.commissionType, line.commissionValue, line.commissionAmount,
            line.override?.reason ?? null, line.override ? input.creatorId : null, line.override ? now : null,
          ],
        );
      }

      const found = await this.readOrder(client, input.tenantId, orderId);
      return { ...found, duplicate: false };
    });
  }

  private async readOrder(client: DbClient, tenantId: string, orderId: string) {
    const order = await client.query(
      `select * from orders where tenant_id = $1 and id = $2`,
      [tenantId, orderId],
    );
    const orderRow = order.rows[0] as Record<string, unknown> | undefined;
    if (!orderRow) {
      throw new CommerceError('unknown-item', 'Order not found for this shop.');
    }
    const items = await client.query(
      `select * from order_items where tenant_id = $1 and order_id = $2 order by created_at`,
      [tenantId, orderId],
    );
    return { order: mapOrderRow(orderRow), items: items.rows.map(mapOrderItemRow) };
  }

  async submitOrder(
    input: { tenantId: string; orderId: string; actorId: string; actorRole: ActorRole; orderReviewRequired: boolean; forceReview?: boolean },
    ctx: OpContext = {},
  ) {
    return withTransaction(this.pool, async (client) => {
      const locked = await client.query(`select * from orders where tenant_id = $1 and id = $2 for update`, [input.tenantId, input.orderId]);
      const orderRow = locked.rows[0] as Record<string, unknown> | undefined;
      if (!orderRow) {
        throw new CommerceError('unknown-item', 'Order not found for this shop.');
      }
      const order = mapOrderRow(orderRow);
      const now = nowISO(ctx);
      order.status = transitionOrderStatus(order.status, 'SUBMITTED');
      const items = (
        await client.query(`select * from order_items where tenant_id = $1 and order_id = $2`, [input.tenantId, input.orderId])
      ).rows.map(mapOrderItemRow);
      const hasDownwardOverride = items.some((item) => item.overrideReason != null && item.actualUnitPrice - item.catalogUnitPrice < 0);
      const decision = routeNewOrder({
        source: order.source as OrderSource,
        creatorRole: input.actorRole,
        hasDownwardOverride,
        orderReviewRequired: input.orderReviewRequired,
        forceReview: input.forceReview ?? false,
      });
      if (decision === 'PENDING_REVIEW') {
        order.status = transitionOrderStatus(order.status, 'PENDING_REVIEW');
        await client.query(`update orders set status = 'PENDING_REVIEW', submitted_at = $3, updated_at = $3 where tenant_id = $1 and id = $2`, [
          input.tenantId, input.orderId, now,
        ]);
      } else {
        order.status = transitionOrderStatus(order.status, 'APPROVED');
        await client.query(
          `update orders set status = 'APPROVED', submitted_at = $3, approved_at = $3, approved_by = $4, updated_at = $3 where tenant_id = $1 and id = $2`,
          [input.tenantId, input.orderId, now, input.actorId],
        );
        order.approvedAt = now;
        order.approvedBy = input.actorId;
      }
      order.submittedAt = now;
      order.updatedAt = now;
      return { order, route: decision };
    });
  }

  async approveOrder(
    input: { tenantId: string; orderId: string; actorId: string; actorRole: ActorRole },
    ctx: OpContext = {},
  ) {
    if (input.actorRole !== 'shop_admin' && input.actorRole !== 'super_admin') {
      throw new CommerceError('not-permitted', 'Only admins can approve orders.');
    }
    return withTransaction(this.pool, async (client) => {
      const locked = await client.query(`select * from orders where tenant_id = $1 and id = $2 for update`, [input.tenantId, input.orderId]);
      const orderRow = locked.rows[0] as Record<string, unknown> | undefined;
      if (!orderRow) {
        throw new CommerceError('unknown-item', 'Order not found for this shop.');
      }
      const existing = await client.query(`select id from sales where tenant_id = $1 and order_id = $2`, [input.tenantId, input.orderId]);
      if (existing.rowCount) {
        const sale = await this.readSale(client, input.tenantId, (existing.rows[0] as Record<string, string>).id);
        return { order: mapOrderRow(orderRow), sale: sale.sale, duplicate: true };
      }
      const order = mapOrderRow(orderRow);
      if (order.status === 'COMPLETED') {
        throw new CommerceError('already-approved', 'That order was already approved.');
      }
      const now = nowISO(ctx);
      if (order.status !== 'APPROVED') {
        order.status = transitionOrderStatus(order.status, 'APPROVED');
      }
      await client.query(`update orders set status = 'APPROVED', approved_at = $3, approved_by = $4, updated_at = $3 where tenant_id = $1 and id = $2`, [
        input.tenantId, input.orderId, now, input.actorId,
      ]);
      order.approvedAt = now;
      order.approvedBy = input.actorId;
      const finalized = await this.finalizeLockedOrder(client, input.tenantId, order, input.actorId, ctx, now);
      return { order: finalized.order, sale: finalized.sale, duplicate: false };
    });
  }

  async finalizeApprovedOrder(
    input: { tenantId: string; orderId: string; actorId: string },
    ctx: OpContext = {},
  ) {
    return withTransaction(this.pool, async (client) => {
      const locked = await client.query(`select * from orders where tenant_id = $1 and id = $2 for update`, [input.tenantId, input.orderId]);
      const orderRow = locked.rows[0] as Record<string, unknown> | undefined;
      if (!orderRow) {
        throw new CommerceError('unknown-item', 'Order not found for this shop.');
      }
      const existing = await client.query(`select id from sales where tenant_id = $1 and order_id = $2`, [input.tenantId, input.orderId]);
      if (existing.rowCount) {
        const sale = await this.readSale(client, input.tenantId, (existing.rows[0] as Record<string, string>).id);
        return { order: mapOrderRow(orderRow), sale: sale.sale, duplicate: true };
      }
      const order = mapOrderRow(orderRow);
      if (order.status === 'COMPLETED') {
        throw new CommerceError('already-approved', 'That order was already approved.');
      }
      if (order.status !== 'APPROVED') {
        throw new CommerceError('invalid-transition', 'Order must be approved before the sale is finalized.');
      }
      const now = nowISO(ctx);
      const finalized = await this.finalizeLockedOrder(client, input.tenantId, order, input.actorId, ctx, now);
      return { order: finalized.order, sale: finalized.sale, duplicate: false };
    });
  }

  /** Finalize a locked APPROVED order: stock-checked sale + items + movements. */
  private async finalizeLockedOrder(
    client: PoolClient,
    tenantId: string,
    order: OpsOrder,
    actorId: string | null,
    ctx: OpContext,
    now: string,
  ): Promise<{ order: OpsOrder; sale: OpsSale }> {
    const items = (
      await client.query(`select * from order_items where tenant_id = $1 and order_id = $2 order by created_at`, [tenantId, order.id])
    ).rows.map(mapOrderItemRow);

    // Lock every product balance this sale touches, in id order (no deadlocks).
    const productIds = [...new Set(items.flatMap((item) => {
      if (item.itemType === 'PRODUCT' && item.productId) {
        return [item.productId];
      }
      return [];
    }))];
    const links = (
      await client.query(`select service_id, product_id, quantity from service_product_links where tenant_id = $1`, [tenantId])
    ).rows.map((row) => ({
      serviceId: row.service_id as string,
      tenantId,
      productId: row.product_id as string,
      quantity: Number(row.quantity),
    }));
    for (const item of items) {
      if (item.itemType === 'SERVICE' && item.serviceId) {
        for (const line of resolveServiceConsumption(links, tenantId, item.serviceId, item.quantity)) {
          productIds.push(line.productId);
        }
      }
    }
    const uniqueIds = [...new Set(productIds)].sort();
    const balances = new Map<string, number>();
    for (const productId of uniqueIds) {
      const locked = await client.query(`select quantity_on_hand, unit_cost from products where tenant_id = $1 and id = $2 for update`, [
        tenantId, productId,
      ]);
      const row = locked.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        throw new CommerceError('unknown-item', 'A product required by this sale is missing.');
      }
      balances.set(productId, Number(row.quantity_on_hand));
    }

    // Pre-validate everything before posting anything.
    const deductions = new Map<string, number>();
    const addDeduction = (productId: string, quantity: number) => {
      deductions.set(productId, (deductions.get(productId) ?? 0) + quantity);
    };
    for (const item of items) {
      if (item.itemType === 'PRODUCT' && item.productId) {
        addDeduction(item.productId, item.quantity);
      } else if (item.itemType === 'SERVICE' && item.serviceId) {
        for (const line of resolveServiceConsumption(links, tenantId, item.serviceId, item.quantity)) {
          addDeduction(line.productId, line.quantity);
        }
      }
    }
    for (const [productId, quantity] of deductions) {
      const onHand = balances.get(productId) ?? 0;
      if (!ctx.allowNegative && onHand - quantity < 0) {
        throw new CommerceError('insufficient-stock', 'Insufficient stock to complete this sale. No stock was deducted.');
      }
    }

    const saleId = newId(ctx);
    await client.query(
      `insert into sales (id, tenant_id, order_id, customer_id, seller_id, status, subtotal, total, currency_code, idempotency_key, approved_at, approved_by, completed_at, recorded_by, seller_credential_id, payment_method, customer_phone, created_at, updated_at)
       values ($1,$2,$3,$4,$5,'COMPLETED',$6,$7,$8,$9,$10,$11,$10,$11,$12,$13,$14,$10,$10)`,
      [
        saleId, tenantId, order.id, order.customerId ?? null, order.sellerId ?? null,
        order.subtotal, order.total, order.currencyCode, order.idempotencyKey ?? null,
        now, actorId, order.sellerCredentialId ?? null, order.paymentMethod ?? null, order.customerPhone ?? null,
      ],
    );

    for (const item of items) {
      const consumed = item.itemType === 'SERVICE' && item.serviceId
        ? resolveServiceConsumption(links, tenantId, item.serviceId, item.quantity)
        : [];
      await client.query(
        `insert into sale_items (id, tenant_id, sale_id, item_type, product_id, service_id, quantity, catalog_unit_price, actual_unit_price, line_total, item_name, item_snapshot, commission_type, commission_value, commission_amount, override_reason, override_by, override_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          newId(ctx), tenantId, saleId, item.itemType, item.productId ?? null, item.serviceId ?? null,
          item.quantity, item.catalogUnitPrice, item.actualUnitPrice, item.lineTotal, item.itemName,
          JSON.stringify({ durationMinutes: null, consumedProducts: consumed }),
          item.commissionType ?? 'percentage', item.commissionValue ?? 0, item.commissionAmount ?? 0,
          item.overrideReason ?? null, item.overrideBy ?? null, item.overrideAt ?? null,
        ],
      );
      if (item.itemType === 'PRODUCT' && item.productId) {
        await this.applyMovement(client, tenantId, item.productId, -item.quantity, 'SALE', saleId, actorId, now, ctx);
      }
      for (const line of consumed) {
        await this.applyMovement(client, tenantId, line.productId, -line.quantity, 'SERVICE_CONSUMPTION', saleId, actorId, now, ctx);
      }
    }

    await client.query(`update orders set status = 'COMPLETED', completed_at = $3, updated_at = $3 where tenant_id = $1 and id = $2`, [
      tenantId, order.id, now,
    ]);
    order.status = 'COMPLETED';
    order.completedAt = now;
    order.updatedAt = now;
    const sale = await this.readSale(client, tenantId, saleId);
    return { order, sale: sale.sale };
  }

  private async applyMovement(
    client: PoolClient,
    tenantId: string,
    productId: string,
    quantity: number,
    type: InventoryMovementType,
    referenceId: string,
    actorId: string | null,
    now: string,
    ctx: OpContext,
    referenceType = 'sale',
    reason: string | null = null,
  ): Promise<void> {
    const locked = await client.query(`select quantity_on_hand, unit_cost from products where tenant_id = $1 and id = $2 for update`, [
      tenantId, productId,
    ]);
    const row = locked.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      throw new CommerceError('unknown-item', 'A product required by this sale is missing.');
    }
    const application = applyMovement(Number(row.quantity_on_hand), { type, quantity }, { allowNegative: ctx.allowNegative });
    await client.query(
      `insert into inventory_movements (id, tenant_id, product_id, quantity, movement_type, reference_type, reference_id, unit_cost, previous_quantity, resulting_quantity, reason, created_by, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        newId(ctx), tenantId, productId, quantity, type, referenceType, referenceId,
        row.unit_cost === null ? null : toNumber(row.unit_cost),
        application.previousQuantity, application.resultingQuantity, reason, actorId, now,
      ],
    );
    await client.query(`update products set quantity_on_hand = $3 where tenant_id = $1 and id = $2`, [
      tenantId, productId, application.resultingQuantity,
    ]);
  }

  private async readSale(client: DbClient, tenantId: string, saleId: string) {
    const sale = await client.query(`select * from sales where tenant_id = $1 and id = $2`, [tenantId, saleId]);
    const saleRow = sale.rows[0] as Record<string, unknown> | undefined;
    if (!saleRow) {
      throw new CommerceError('unknown-item', 'Sale not found for this shop.');
    }
    const items = await client.query(`select * from sale_items where tenant_id = $1 and sale_id = $2 order by created_at`, [tenantId, saleId]);
    return { sale: mapSaleRow(saleRow), items: items.rows.map(mapSaleItemRow) };
  }

  async rejectOrder(
    input: { tenantId: string; orderId: string; actorId: string; actorRole: ActorRole; reason?: string | null },
    ctx: OpContext = {},
  ) {
    if (input.actorRole !== 'shop_admin' && input.actorRole !== 'super_admin') {
      throw new CommerceError('not-permitted', 'Only admins can reject orders.');
    }
    return withTransaction(this.pool, async (client) => {
      const locked = await client.query(`select * from orders where tenant_id = $1 and id = $2 for update`, [input.tenantId, input.orderId]);
      const orderRow = locked.rows[0] as Record<string, unknown> | undefined;
      if (!orderRow) {
        throw new CommerceError('unknown-item', 'Order not found for this shop.');
      }
      const order = mapOrderRow(orderRow);
      const now = nowISO(ctx);
      order.status = transitionOrderStatus(order.status, 'REJECTED');
      await client.query(`update orders set status = 'REJECTED', rejected_at = $3, rejection_reason = $4, updated_at = $3 where tenant_id = $1 and id = $2`, [
        input.tenantId, input.orderId, now, input.reason?.trim() || null,
      ]);
      order.rejectedAt = now;
      order.rejectionReason = input.reason?.trim() || null;
      order.updatedAt = now;
      return order;
    });
  }

  async cancelOrder(input: { tenantId: string; orderId: string }, ctx: OpContext = {}) {
    return withTransaction(this.pool, async (client) => {
      const locked = await client.query(`select * from orders where tenant_id = $1 and id = $2 for update`, [input.tenantId, input.orderId]);
      const orderRow = locked.rows[0] as Record<string, unknown> | undefined;
      if (!orderRow) {
        throw new CommerceError('unknown-item', 'Order not found for this shop.');
      }
      const order = mapOrderRow(orderRow);
      const now = nowISO(ctx);
      order.status = transitionOrderStatus(order.status, 'CANCELLED');
      await client.query(`update orders set status = 'CANCELLED', cancelled_at = $3, updated_at = $3 where tenant_id = $1 and id = $2`, [
        input.tenantId, input.orderId, now,
      ]);
      order.cancelledAt = now;
      order.updatedAt = now;
      return order;
    });
  }

  async voidSale(
    input: { tenantId: string; saleId: string; actorId: string; actorRole: ActorRole; reason?: string | null },
    ctx: OpContext = {},
  ) {
    if (input.actorRole !== 'shop_admin' && input.actorRole !== 'super_admin') {
      throw new CommerceError('not-permitted', 'Only admins can void sales.');
    }
    return withTransaction(this.pool, async (client) => {
      const locked = await client.query(`select * from sales where tenant_id = $1 and id = $2 for update`, [input.tenantId, input.saleId]);
      const saleRow = locked.rows[0] as Record<string, unknown> | undefined;
      if (!saleRow) {
        throw new CommerceError('unknown-item', 'Sale not found for this shop.');
      }
      const sale = mapSaleRow(saleRow);
      if (sale.status === 'VOIDED') {
        throw new CommerceError('already-voided', 'That sale was already voided.');
      }
      if (sale.status !== 'COMPLETED') {
        throw new CommerceError('invalid-transition', 'Only completed sales can be voided.');
      }
      const now = nowISO(ctx);
      const items = (
        await client.query(`select * from sale_items where tenant_id = $1 and sale_id = $2`, [input.tenantId, input.saleId])
      ).rows.map(mapSaleItemRow);
      const reversals: OpsMovement[] = [];
      for (const item of items) {
        if (item.itemType === 'PRODUCT' && item.productId) {
          reversals.push(await this.insertReversal(client, sale, item.productId, item.quantity, 'RETURN', input.actorId, now, ctx));
        }
        const consumed = ((item.itemSnapshot ?? {}) as Record<string, unknown>).consumedProducts as { productId: string; quantity: number }[] | undefined ?? [];
        for (const line of consumed) {
          reversals.push(await this.insertReversal(client, sale, line.productId, line.quantity, 'ADJUSTMENT', input.actorId, now, ctx));
        }
      }
      await client.query(`update sales set status = 'VOIDED', voided_at = $3, voided_by = $4, void_reason = $5, updated_at = $3 where tenant_id = $1 and id = $2`, [
        input.tenantId, input.saleId, now, input.actorId, input.reason?.trim() || 'Sale voided.',
      ]);
      sale.status = 'VOIDED';
      sale.voidedAt = now;
      sale.voidedBy = input.actorId;
      sale.voidReason = input.reason?.trim() || 'Sale voided.';
      sale.updatedAt = now;
      return { sale, reversals };
    });
  }

  private async insertReversal(
    client: PoolClient,
    sale: OpsSale,
    productId: string,
    quantity: number,
    type: InventoryMovementType,
    actorId: string | null,
    now: string,
    ctx: OpContext,
  ): Promise<OpsMovement> {
    const locked = await client.query(`select quantity_on_hand, unit_cost from products where tenant_id = $1 and id = $2 for update`, [
      sale.tenantId, productId,
    ]);
    const row = locked.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      throw new CommerceError('unknown-item', 'A product required by this reversal is missing.');
    }
    const application = applyMovement(Number(row.quantity_on_hand), { type, quantity }, { allowNegative: true });
    const movement: OpsMovement = {
      id: newId(ctx),
      tenantId: sale.tenantId,
      productId,
      quantity,
      movementType: type,
      referenceType: 'sale_void',
      referenceId: sale.id,
      unitCost: row.unit_cost === null ? null : toNumber(row.unit_cost),
      previousQuantity: application.previousQuantity,
      resultingQuantity: application.resultingQuantity,
      reason: `Reversal for voided sale ${sale.id}`,
      createdBy: actorId,
      createdAt: now,
    };
    await client.query(
      `insert into inventory_movements (id, tenant_id, product_id, quantity, movement_type, reference_type, reference_id, unit_cost, previous_quantity, resulting_quantity, reason, created_by, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        movement.id, movement.tenantId, movement.productId, movement.quantity, movement.movementType,
        movement.referenceType, movement.referenceId, movement.unitCost, movement.previousQuantity,
        movement.resultingQuantity, movement.reason, movement.createdBy, movement.createdAt,
      ],
    );
    await client.query(`update products set quantity_on_hand = $3 where tenant_id = $1 and id = $2`, [
      sale.tenantId, productId, application.resultingQuantity,
    ]);
    return movement;
  }

  async getOrderWithItems(tenantId: string, orderId: string) {
    const { rows } = await this.pool.query(`select * from orders where tenant_id = $1 and id = $2`, [tenantId, orderId]);
    const orderRow = rows[0] as Record<string, unknown> | undefined;
    if (!orderRow) {
      return null;
    }
    const items = await this.pool.query(`select * from order_items where tenant_id = $1 and order_id = $2 order by created_at`, [tenantId, orderId]);
    return { order: mapOrderRow(orderRow), items: items.rows.map(mapOrderItemRow) };
  }

  async getSaleWithItems(tenantId: string, saleId: string) {
    const { rows } = await this.pool.query(`select * from sales where tenant_id = $1 and id = $2`, [tenantId, saleId]);
    const saleRow = rows[0] as Record<string, unknown> | undefined;
    if (!saleRow) {
      return null;
    }
    const items = await this.pool.query(`select * from sale_items where tenant_id = $1 and sale_id = $2 order by created_at`, [tenantId, saleId]);
    return { sale: mapSaleRow(saleRow), items: items.rows.map(mapSaleItemRow) };
  }

  // ── inventory ──

  async postInventoryMovement(input: PostMovementInput, ctx: OpContext = {}) {
    return withTransaction(this.pool, async (client) => {
      const locked = await client.query(`select quantity_on_hand, unit_cost from products where tenant_id = $1 and id = $2 for update`, [
        input.tenantId, input.productId,
      ]);
      const row = locked.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        throw new CommerceError('unknown-item', 'Product not found for this shop.');
      }
      const application = applyMovement(Number(row.quantity_on_hand), { type: input.type, quantity: input.quantity }, {
        allowNegative: ctx.allowNegative,
      });
      const now = nowISO(ctx);
      const movement: OpsMovement = {
        id: newId(ctx),
        tenantId: input.tenantId,
        productId: input.productId,
        quantity: input.quantity,
        movementType: input.type,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        unitCost: input.unitCost ?? (row.unit_cost === null ? null : toNumber(row.unit_cost)),
        previousQuantity: application.previousQuantity,
        resultingQuantity: application.resultingQuantity,
        reason: input.reason ?? null,
        createdBy: input.createdBy ?? null,
        createdAt: now,
      };
      await client.query(
        `insert into inventory_movements (id, tenant_id, product_id, quantity, movement_type, reference_type, reference_id, unit_cost, previous_quantity, resulting_quantity, reason, created_by, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          movement.id, movement.tenantId, movement.productId, movement.quantity, movement.movementType,
          movement.referenceType, movement.referenceId, movement.unitCost, movement.previousQuantity,
          movement.resultingQuantity, movement.reason, movement.createdBy, movement.createdAt,
        ],
      );
      await client.query(`update products set quantity_on_hand = $3 where tenant_id = $1 and id = $2`, [
        input.tenantId, input.productId, application.resultingQuantity,
      ]);
      return movement;
    });
  }

  async postOpeningBalance(
    input: Omit<PostMovementInput, 'type' | 'quantity'> & { quantity: number },
    ctx: OpContext = {},
  ) {
    const balance = await this.getProductBalance(input.tenantId, input.productId);
    if (balance !== 0) {
      throw new InventoryError('no-change', 'Opening balance is already recorded for this product. Record an adjustment instead.');
    }
    return this.postInventoryMovement({ ...input, type: 'OPENING_BALANCE' }, ctx);
  }

  async adjustProductStock(
    input: { tenantId: string; productId: string; countedQuantity: number; reason?: string | null; createdBy?: string | null },
    ctx: OpContext = {},
  ) {
    const balance = await this.getProductBalance(input.tenantId, input.productId);
    const plan = planAdjustment(balance, input.countedQuantity);
    return this.postInventoryMovement(
      {
        tenantId: input.tenantId,
        productId: input.productId,
        type: 'ADJUSTMENT',
        quantity: plan.quantity,
        reason: input.reason ?? null,
        createdBy: input.createdBy ?? null,
      },
      ctx,
    );
  }

  async consumeServiceBom(
    tenantId: string,
    serviceId: string,
    times: number,
    reference: { referenceType: string; referenceId: string; createdBy?: string | null },
  ): Promise<OpsMovement[]> {
    return withTransaction(this.pool, async (client) => {
      const links = (
        await client.query(`select service_id, product_id, quantity from service_product_links where tenant_id = $1`, [tenantId])
      ).rows.map((row) => ({
        serviceId: row.service_id as string,
        tenantId,
        productId: row.product_id as string,
        quantity: Number(row.quantity),
      }));
      const lines = resolveServiceConsumption(links, tenantId, serviceId, times);
      const movements: OpsMovement[] = [];
      for (const line of lines) {
        const locked = await client.query(`select quantity_on_hand, unit_cost from products where tenant_id = $1 and id = $2 for update`, [
          tenantId, line.productId,
        ]);
        const row = locked.rows[0] as Record<string, unknown> | undefined;
        if (!row) {
          throw new CommerceError('unknown-item', 'A product required by this sale is missing.');
        }
        const now = nowISO({});
        const application = applyMovement(Number(row.quantity_on_hand), { type: 'SERVICE_CONSUMPTION', quantity: -line.quantity });
        const movement: OpsMovement = {
          id: newId({}),
          tenantId,
          productId: line.productId,
          quantity: -line.quantity,
          movementType: 'SERVICE_CONSUMPTION',
          referenceType: reference.referenceType,
          referenceId: reference.referenceId,
          unitCost: row.unit_cost === null ? null : toNumber(row.unit_cost),
          previousQuantity: application.previousQuantity,
          resultingQuantity: application.resultingQuantity,
          reason: null,
          createdBy: reference.createdBy ?? null,
          createdAt: now,
        };
        await client.query(
          `insert into inventory_movements (id, tenant_id, product_id, quantity, movement_type, reference_type, reference_id, unit_cost, previous_quantity, resulting_quantity, reason, created_by, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            movement.id, movement.tenantId, movement.productId, movement.quantity, movement.movementType,
            movement.referenceType, movement.referenceId, movement.unitCost, movement.previousQuantity,
            movement.resultingQuantity, movement.reason, movement.createdBy, movement.createdAt,
          ],
        );
        await client.query(`update products set quantity_on_hand = $3 where tenant_id = $1 and id = $2`, [
          tenantId, line.productId, application.resultingQuantity,
        ]);
        movements.push(movement);
      }
      return movements;
    });
  }

  // ── payments ──

  async createPayment(input: CreatePaymentInput, ctx: OpContext = {}) {
    return withTransaction(this.pool, async (client) => {
      const existing = await client.query(
        `select * from payments where tenant_id = $1 and idempotency_key = $2`,
        [input.tenantId, input.idempotencyKey],
      );
      if (existing.rowCount) {
        return { payment: mapPaymentRow(existing.rows[0] as Record<string, unknown>), duplicate: true };
      }
      const now = nowISO(ctx);
      const id = newId(ctx);
      try {
        await client.query(
          `insert into payments (id, tenant_id, order_id, sale_id, provider, method, status, amount, currency_code, customer_phone, provider_reference, provider_request_id, idempotency_key, attempt_number, initiated_at, expires_at, payment_connection_id, provider_merchant_id, created_by, created_at, updated_at)
           values ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$14,$14)`,
          [
            id, input.tenantId, input.orderId ?? null, input.saleId ?? null, input.provider, input.method,
            input.amount, input.currencyCode, input.customerPhone ?? null, input.providerReference ?? null,
            input.providerRequestId ?? null, input.idempotencyKey, input.attemptNumber, now,
            input.expiresAt ?? null, input.connection?.connectionId ?? null, input.connection?.providerMerchantId ?? null,
            input.createdBy ?? null,
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          const retry = await client.query(
            `select * from payments where tenant_id = $1 and idempotency_key = $2`,
            [input.tenantId, input.idempotencyKey],
          );
          const row = retry.rows[0] as Record<string, unknown> | undefined;
          if (row) {
            return { payment: mapPaymentRow(row), duplicate: true };
          }
        }
        throw error;
      }
      const created = await client.query(`select * from payments where tenant_id = $1 and id = $2`, [input.tenantId, id]);
      return { payment: mapPaymentRow(created.rows[0] as Record<string, unknown>), duplicate: false };
    });
  }

  async transitionPayment(input: TransitionPaymentInput, ctx: OpContext = {}) {
    return withTransaction(this.pool, async (client) => {
      const now = nowISO(ctx);
      const setClauses: string[] = [`status = $4`, `updated_at = $5`];
      const params: unknown[] = [input.tenantId, input.paymentId, 'PENDING', input.to, now];
      if (input.providerReference !== undefined) {
        setClauses.push(`provider_reference = $${params.length + 1}`);
        params.push(input.providerReference);
      }
      if (input.to === 'SUCCESS') {
        setClauses.push(`confirmed_at = $${params.length + 1}`);
        params.push(now);
      } else if (input.to !== 'PENDING') {
        setClauses.push(`failed_at = $${params.length + 1}`);
        params.push(now);
        setClauses.push(`failure_code = $${params.length + 1}`);
        params.push(input.failureCode ?? null);
        setClauses.push(`failure_reason = $${params.length + 1}`);
        params.push(input.failureReason ?? null);
      }
      const updated = await client.query(
        `update payments set ${setClauses.join(', ')} where tenant_id = $1 and id = $2 and status = $3 returning *`,
        params,
      );
      if (updated.rowCount) {
        return { payment: mapPaymentRow(updated.rows[0] as Record<string, unknown>), duplicate: false };
      }
      // Convergent retry: already transitioned — return the stored outcome.
      const current = await client.query(`select * from payments where tenant_id = $1 and id = $2`, [input.tenantId, input.paymentId]);
      const row = current.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        throw new PaymentError('unknown-payment', 'Payment not found for this shop.');
      }
      if (row.status === 'PENDING') {
        throw new PaymentError('invalid-transition', 'Payment could not transition.');
      }
      return { payment: mapPaymentRow(row), duplicate: true };
    });
  }

  async getPaymentByIdempotency(tenantId: string, key: string) {
    const { rows } = await this.pool.query(`select * from payments where tenant_id = $1 and idempotency_key = $2`, [tenantId, key]);
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? mapPaymentRow(row) : null;
  }

  async getPaymentByIdGlobal(paymentId: string) {
    const { rows } = await this.pool.query(`select * from payments where id = $1`, [paymentId]);
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? mapPaymentRow(row) : null;
  }

  async updatePaymentProviderDetails(
    input: { tenantId: string; paymentId: string; providerRequestId?: string | null; providerReference?: string | null; expiresAt?: string | null },
    ctx: OpContext = {},
  ) {
    const { rows } = await this.pool.query(
      `update payments set provider_request_id = coalesce($3, provider_request_id), provider_reference = coalesce($4, provider_reference), expires_at = coalesce($5, expires_at), updated_at = $6
       where tenant_id = $1 and id = $2 returning *`,
      [input.tenantId, input.paymentId, input.providerRequestId ?? null, input.providerReference ?? null, input.expiresAt ?? null, nowISO(ctx)],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      throw new PaymentError('unknown-payment', 'Payment not found for this shop.');
    }
    return mapPaymentRow(row);
  }

  async completePaidOrder(
    input: { tenantId: string; orderId: string; paymentId: string; actorId: string },
    ctx: OpContext = {},
  ): Promise<{ order: OpsOrder; sale: OpsSale; payment: OpsPayment; outcome: 'completed' | 'needs-recovery' }> {
    try {
      return await withTransaction(this.pool, async (client) => {
        const payment = await client.query(`select * from payments where tenant_id = $1 and id = $2 for update`, [input.tenantId, input.paymentId]);
        const paymentRow = payment.rows[0] as Record<string, unknown> | undefined;
        if (!paymentRow) {
          throw new PaymentError('unknown-payment', 'Payment not found for this shop.');
        }
        if (paymentRow.status !== 'SUCCESS') {
          throw new CommerceError('invalid-transition', 'Payment is not confirmed.');
        }
        // System settlement has no users row: approved_by/recorded_by stay
        // NULL (the payment row + timestamps carry the audit trail). The file
        // adapter records the literal 'system' string instead (no FK there).
        // Guard the lookup: non-uuid actor ids (e.g. 'system') skip the query.
        let actorOrNull: string | null = null;
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.actorId)) {
          const actorUser = await client.query(`select id from users where tenant_id = $1 and id = $2`, [input.tenantId, input.actorId]);
          actorOrNull = actorUser.rowCount ? input.actorId : null;
        }
        const locked = await client.query(`select * from orders where tenant_id = $1 and id = $2 for update`, [input.tenantId, input.orderId]);
        const orderRow = locked.rows[0] as Record<string, unknown> | undefined;
        if (!orderRow) {
          throw new CommerceError('unknown-item', 'Order not found for this shop.');
        }
        const now = nowISO(ctx);
        const order = mapOrderRow(orderRow);
        if (order.status === 'PENDING_REVIEW' || order.status === 'SUBMITTED') {
          order.status = transitionOrderStatus(order.status, 'APPROVED');
          await client.query(`update orders set status = 'APPROVED', approved_at = $3, approved_by = $4, updated_at = $3 where tenant_id = $1 and id = $2`, [
            input.tenantId, input.orderId, now, actorOrNull,
          ]);
          order.approvedAt = now;
          order.approvedBy = actorOrNull;
        }
        const finalized = await this.finalizeLockedOrder(client, input.tenantId, order, actorOrNull, ctx, now);
        await client.query(`update payments set sale_id = $3, needs_recovery = false, recovery_reason = null, updated_at = $4 where tenant_id = $1 and id = $2`, [
          input.tenantId, input.paymentId, finalized.sale.id, now,
        ]);
        const refreshed = await client.query(`select * from payments where tenant_id = $1 and id = $2`, [input.tenantId, input.paymentId]);
        return {
          order: finalized.order,
          sale: finalized.sale,
          payment: mapPaymentRow(refreshed.rows[0] as Record<string, unknown>),
          outcome: 'completed' as const,
        };
      });
    } catch (error) {
      if (error instanceof CommerceError && error.code === 'insufficient-stock') {
        await this.pool.query(`update payments set needs_recovery = true, recovery_reason = $3, updated_at = $4 where tenant_id = $1 and id = $2`, [
          input.tenantId, input.paymentId, `Stock unavailable at finalization for order ${input.orderId}.`, nowISO(ctx),
        ]);
        const order = await this.getOrderWithItems(input.tenantId, input.orderId);
        const payment = await this.pool.query(`select * from payments where tenant_id = $1 and id = $2`, [input.tenantId, input.paymentId]);
        const sale = await this.pool.query(`select * from sales where tenant_id = $1 and order_id = $2`, [input.tenantId, input.orderId]);
        const saleRow = sale.rows[0] as Record<string, unknown> | undefined;
        return {
          order: order?.order as OpsOrder,
          sale: (saleRow ? mapSaleRow(saleRow) : null) as unknown as OpsSale,
          payment: mapPaymentRow(payment.rows[0] as Record<string, unknown>),
          outcome: 'needs-recovery' as const,
        };
      }
      throw error;
    }
  }

  async recoverPaidOrder(
    input: { tenantId: string; paymentId: string; actorId: string },
    ctx: OpContext = {},
  ) {
    const { rows } = await this.pool.query(`select * from payments where tenant_id = $1 and id = $2`, [input.tenantId, input.paymentId]);
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      throw new PaymentError('unknown-payment', 'Payment not found for this shop.');
    }
    if (row.status !== 'SUCCESS' || !row.needs_recovery) {
      throw new CommerceError('invalid-transition', 'That payment does not need recovery.');
    }
    if (!row.order_id) {
      throw new CommerceError('unknown-item', 'Recoverable payment has no order.');
    }
    const completed = await this.completePaidOrder(
      { tenantId: input.tenantId, orderId: row.order_id as string, paymentId: input.paymentId, actorId: input.actorId },
      ctx,
    );
    if (completed.outcome !== 'completed') {
      throw new CommerceError('insufficient-stock', 'Stock is still unavailable. The payment remains flagged for recovery.');
    }
    return { order: completed.order, sale: completed.sale, payment: completed.payment };
  }

  async amendSale(
    input: {
      tenantId: string;
      saleId: string;
      corrected: {
        price: number;
        serviceId: string | null;
        serviceName: string;
        commissionType: 'fixed' | 'percentage';
        commissionValue: number;
        commissionAmount: number;
      };
      actorId: string;
      reason?: string | null;
    },
    ctx: OpContext = {},
  ) {
    const reason = (input.reason ?? '').trim();
    if (!reason) {
      throw new CommerceError('amendment-reason-required', 'Corrections to linked sales need a reason.');
    }
    return withTransaction(this.pool, async (client) => {
      const locked = await client.query(`select * from sales where tenant_id = $1 and id = $2 for update`, [input.tenantId, input.saleId]);
      const saleRow = locked.rows[0] as Record<string, unknown> | undefined;
      if (!saleRow) {
        throw new CommerceError('unknown-item', 'Sale not found for this shop.');
      }
      const sale = mapSaleRow(saleRow);
      if (sale.status !== 'COMPLETED') {
        throw new CommerceError('invalid-transition', 'Only completed sales can be amended.');
      }
      const itemRows = await client.query(`select * from sale_items where tenant_id = $1 and sale_id = $2`, [input.tenantId, input.saleId]);
      const items = itemRows.rows.map(mapSaleItemRow);
      if (items.length !== 1 || items[0].itemType !== 'SERVICE') {
        throw new CommerceError('invalid-transition', 'That engine sale has unexpected lines for amendment.');
      }
      const item = items[0];
      const now = nowISO(ctx);
      const fieldChanges: { field: string; previous: unknown; current: unknown }[] = [];
      const track = (field: string, previous: unknown, current: unknown) => {
        if (JSON.stringify(previous) !== JSON.stringify(current)) {
          fieldChanges.push({ field, previous, current });
        }
      };
      const previousTotal = sale.total;
      track('actualUnitPrice', item.actualUnitPrice, input.corrected.price);
      track('commissionAmount', item.commissionAmount, input.corrected.commissionAmount);

      let stockSynced = false;
      if ((item.serviceId ?? null) !== (input.corrected.serviceId ?? null)) {
        const links = (
          await client.query(`select service_id, product_id, quantity from service_product_links where tenant_id = $1`, [input.tenantId])
        ).rows.map((row) => ({
          serviceId: (row as Record<string, unknown>).service_id as string,
          tenantId: input.tenantId,
          productId: (row as Record<string, unknown>).product_id as string,
          quantity: Number((row as Record<string, unknown>).quantity),
        }));
        const consumed = ((item.itemSnapshot ?? {}) as Record<string, unknown>).consumedProducts as { productId: string; quantity: number }[] | undefined ?? [];
        const fresh = resolveServiceConsumption(links, input.tenantId, input.corrected.serviceId ?? '', item.quantity);
        for (const line of fresh) {
          const balance = await client.query(`select quantity_on_hand from products where tenant_id = $1 and id = $2`, [input.tenantId, line.productId]);
          const onHand = Number((balance.rows[0] as Record<string, unknown> | undefined)?.quantity_on_hand ?? 0);
          if (!(balance.rows[0] && (ctx.allowNegative || onHand - line.quantity >= 0))) {
            throw new CommerceError('insufficient-stock', 'Insufficient stock to restate this sale to the new service. Nothing was changed.');
          }
        }
        track('serviceId', item.serviceId, input.corrected.serviceId);
        for (const line of consumed) {
          await this.applyMovement(client, input.tenantId, line.productId, line.quantity, 'ADJUSTMENT', input.saleId, input.actorId, now, ctx, 'sale_correction', `Correction restatement for sale ${input.saleId}`);
        }
        for (const line of fresh) {
          await this.applyMovement(client, input.tenantId, line.productId, -line.quantity, 'SERVICE_CONSUMPTION', input.saleId, input.actorId, now, ctx, 'sale_correction');
        }
        await client.query(`update sale_items set service_id = $3, item_name = $4, item_snapshot = $5 where tenant_id = $1 and id = $2`, [
          input.tenantId, item.id, input.corrected.serviceId, input.corrected.serviceName,
          JSON.stringify({ ...((item.itemSnapshot ?? {}) as Record<string, unknown>), consumedProducts: fresh }),
        ]);
        stockSynced = true;
      }

      await client.query(
        `update sale_items set actual_unit_price = $3, line_total = $4, commission_type = $5, commission_value = $6, commission_amount = $7 where tenant_id = $1 and id = $2`,
        [input.tenantId, item.id, input.corrected.price, input.corrected.price * item.quantity, input.corrected.commissionType, input.corrected.commissionValue, input.corrected.commissionAmount],
      );
      const newTotal = input.corrected.price * item.quantity;
      await client.query(`update sales set subtotal = $3, total = $3, updated_at = $4 where tenant_id = $1 and id = $2`, [
        input.tenantId, input.saleId, newTotal, now,
      ]);
      track('total', previousTotal, newTotal);
      await client.query(
        `insert into sale_amendments (id, tenant_id, sale_id, previous_total, new_total, field_changes, reason, actor_id, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [newId(ctx), input.tenantId, input.saleId, previousTotal, newTotal, JSON.stringify(fieldChanges), reason, input.actorId, now],
      );
      const refreshed = await this.readSale(client, input.tenantId, input.saleId);
      return { amended: true, sale: refreshed.sale, stockSynced };
    });
  }

  async getPaymentByProviderRequest(tenantId: string, providerRequestId: string) {
    const { rows } = await this.pool.query(`select * from payments where tenant_id = $1 and provider_request_id = $2 order by created_at desc limit 1`, [
      tenantId, providerRequestId,
    ]);
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? mapPaymentRow(row) : null;
  }

  async getPaymentByProviderRequestGlobal(providerRequestId: string) {
    const { rows } = await this.pool.query(`select * from payments where provider_request_id = $1 order by created_at desc limit 1`, [
      providerRequestId,
    ]);
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? mapPaymentRow(row) : null;
  }

  async getPaymentsByOrder(tenantId: string, orderId: string) {
    const { rows } = await this.pool.query(`select * from payments where tenant_id = $1 and order_id = $2 order by created_at desc`, [
      tenantId, orderId,
    ]);
    return rows.map((row) => mapPaymentRow(row as Record<string, unknown>));
  }

  async markPaymentRecovery(tenantId: string, paymentId: string, reason: string, ctx: OpContext = {}) {
    const { rows } = await this.pool.query(
      `update payments set needs_recovery = true, recovery_reason = $3, updated_at = $4 where tenant_id = $1 and id = $2 returning *`,
      [tenantId, paymentId, reason, nowISO(ctx)],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      throw new PaymentError('unknown-payment', 'Payment not found for this shop.');
    }
    return mapPaymentRow(row);
  }

  // ── credentials / reads ──

  async verifySellerCredential(tenantId: string, reference: unknown, bearer: unknown) {
    const text = typeof reference === 'string' ? reference.trim() : '';
    if (!/^sel-[a-z0-9]{16}$/.test(text)) {
      throw new SellerError('invalid-reference', 'This seller QR code is not recognized.');
    }
    const { rows } = await this.pool.query(`select * from seller_credentials where public_reference = $1`, [text]);
    const credential = rows[0] as Record<string, unknown> | undefined;
    if (!credential || credential.tenant_id !== tenantId) {
      throw new SellerError('invalid-reference', 'This seller QR code is not recognized.');
    }
    if (credential.status !== 'ACTIVE') {
      throw new SellerError('credential-revoked', 'This seller QR code is no longer active.');
    }
    const presented = Buffer.from(typeof bearer === 'string' ? bearer : '', 'utf8');
    const expected = Buffer.from(hashSellerBearer(typeof bearer === 'string' ? bearer : ''), 'utf8');
    const stored = Buffer.from((credential.token_hash as string | null) ?? '', 'utf8');
    if (presented.length === 0 || stored.length !== expected.length || !timingSafeEqual(stored, expected)) {
      throw new SellerError('invalid-bearer', 'This seller QR code is not recognized.');
    }
    if (credential.expires_at && Date.parse(credential.expires_at as string) <= Date.now()) {
      throw new SellerError('credential-expired', 'This seller QR code has expired. Ask an admin for a new one.');
    }
    const seller = await this.pool.query(`select tenant_id, is_active, full_name from users where id = $1`, [credential.seller_id]);
    const sellerRow = seller.rows[0] as Record<string, unknown> | undefined;
    if (!sellerRow || sellerRow.tenant_id !== tenantId || !sellerRow.is_active) {
      throw new SellerError('inactive-seller', 'That seller account is inactive.');
    }
    return {
      tenantId: credential.tenant_id as string,
      sellerId: credential.seller_id as string,
      credentialId: credential.id as string,
      publicReference: credential.public_reference as string,
      sellerName: (sellerRow.full_name as string | null) ?? null,
    };
  }

  async touchSellerCredentialUsed(tenantId: string, credentialId: string) {
    await this.pool.query(`update seller_credentials set last_used_at = now(), updated_at = now() where tenant_id = $1 and id = $2`, [
      tenantId, credentialId,
    ]);
  }

  async resolveSellerCredentialTenant(reference: string) {
    const { rows } = await this.pool.query(`select tenant_id from seller_credentials where public_reference = $1`, [reference]);
    const row = rows[0] as Record<string, unknown> | undefined;
    return (row?.tenant_id as string | null) ?? null;
  }

  async getOrderView(tenantId: string, orderId: string): Promise<OrderView | null> {
    const found = await this.getOrderWithItems(tenantId, orderId);
    if (!found) {
      return null;
    }
    const names = await this.pool.query(
      `select (select full_name from users where id = $2) as seller_name,
              (select name from customers where id = $3) as customer_name`,
      [tenantId, found.order.sellerId, found.order.customerId],
    );
    const namesRow = (names.rows[0] ?? {}) as Record<string, unknown>;
    return {
      id: found.order.id,
      tenantId: found.order.tenantId,
      customerId: found.order.customerId,
      customerName: (namesRow.customer_name as string | null) ?? null,
      sellerId: found.order.sellerId,
      sellerName: (namesRow.seller_name as string | null) ?? null,
      status: found.order.status as OrderView['status'],
      subtotal: found.order.subtotal,
      total: found.order.total,
      currencyCode: found.order.currencyCode,
      source: found.order.source,
      notes: null,
      items: found.items.map((item): OrderItemView => ({
        id: item.id,
        tenantId: item.tenantId,
        orderId: item.orderId,
        itemType: item.itemType,
        productId: item.productId,
        serviceId: item.serviceId,
        quantity: item.quantity,
        catalogUnitPrice: item.catalogUnitPrice,
        actualUnitPrice: item.actualUnitPrice,
        lineTotal: item.lineTotal,
        itemName: item.itemName,
        commissionType: item.commissionType,
        commissionValue: item.commissionValue,
        commissionAmount: item.commissionAmount,
        overrideReason: item.overrideReason,
      })),
      submittedAt: found.order.submittedAt,
      approvedAt: found.order.approvedAt,
      completedAt: found.order.completedAt,
      createdAt: found.order.createdAt,
      sellerCredentialId: found.order.sellerCredentialId,
    };
  }

  async getSaleView(tenantId: string, saleId: string): Promise<SaleView | null> {
    const found = await this.getSaleWithItems(tenantId, saleId);
    if (!found) {
      return null;
    }
    const names = await this.pool.query(
      `select (select full_name from users where id = $2) as seller_name,
              (select name from customers where id = $3) as customer_name,
              (select source from orders where tenant_id = $1 and id = $4) as source`,
      [tenantId, found.sale.sellerId, found.sale.customerId, found.sale.orderId],
    );
    const namesRow = (names.rows[0] ?? {}) as Record<string, unknown>;
    return {
      id: found.sale.id,
      tenantId: found.sale.tenantId,
      orderId: found.sale.orderId,
      customerId: found.sale.customerId,
      customerName: (namesRow.customer_name as string | null) ?? null,
      sellerId: found.sale.sellerId,
      sellerName: (namesRow.seller_name as string | null) ?? null,
      status: found.sale.status as SaleView['status'],
      subtotal: found.sale.subtotal,
      total: found.sale.total,
      currencyCode: found.sale.currencyCode,
      source: (namesRow.source as string | null) ?? 'STAFF',
      items: found.items.map((item): SaleItemView => ({
        id: item.id,
        tenantId: item.tenantId,
        saleId: item.saleId,
        itemType: item.itemType,
        productId: item.productId,
        serviceId: item.serviceId,
        quantity: item.quantity,
        catalogUnitPrice: item.catalogUnitPrice,
        actualUnitPrice: item.actualUnitPrice,
        lineTotal: item.lineTotal,
        itemName: item.itemName,
        commissionType: item.commissionType,
        commissionValue: item.commissionValue,
        commissionAmount: item.commissionAmount,
        overrideReason: item.overrideReason,
        overrideHistoryUnknown: item.overrideHistoryUnknown,
      })),
      completedAt: found.sale.completedAt,
      voidedAt: found.sale.voidedAt,
      voidReason: found.sale.voidReason,
      createdAt: found.sale.createdAt,
      sellerCredentialId: found.sale.sellerCredentialId,
      paymentMethod: found.sale.paymentMethod,
      customerPhone: found.sale.customerPhone,
    };
  }

  async listOrderViews(tenantId: string, filters: { sellerId?: string } = {}): Promise<OrderView[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];
    if (filters.sellerId) {
      conditions.push(`seller_id = $${params.length + 1}`);
      params.push(filters.sellerId);
    }
    const { rows } = await this.pool.query(
      `select o.*, cu.name as customer_name, u.full_name as seller_name
       from orders o left join customers cu on cu.tenant_id = o.tenant_id and cu.id = o.customer_id
       left join users u on u.tenant_id = o.tenant_id and u.id = o.seller_id
       where ${conditions.join(' and ')} order by o.created_at desc`,
      params,
    );
    const views: OrderView[] = [];
    for (const row of rows) {
      const record = row as Record<string, unknown>;
      const items = await this.pool.query(`select * from order_items where tenant_id = $1 and order_id = $2 order by created_at`, [
        tenantId, record.id as string,
      ]);
      const order = mapOrderRow(record);
      views.push({
        id: order.id,
        tenantId: order.tenantId,
        customerId: order.customerId,
        customerName: (record.customer_name as string | null) ?? null,
        sellerId: order.sellerId,
        sellerName: (record.seller_name as string | null) ?? null,
        status: order.status as OrderView['status'],
        subtotal: order.subtotal,
        total: order.total,
        currencyCode: order.currencyCode,
        source: order.source,
        notes: null,
        items: items.rows.map((item) => {
          const mapped = mapOrderItemRow(item as Record<string, unknown>);
          return {
            id: mapped.id, tenantId: mapped.tenantId, orderId: mapped.orderId, itemType: mapped.itemType,
            productId: mapped.productId, serviceId: mapped.serviceId, quantity: mapped.quantity,
            catalogUnitPrice: mapped.catalogUnitPrice, actualUnitPrice: mapped.actualUnitPrice,
            lineTotal: mapped.lineTotal, itemName: mapped.itemName, commissionType: mapped.commissionType,
            commissionValue: mapped.commissionValue, commissionAmount: mapped.commissionAmount,
            overrideReason: mapped.overrideReason,
          } as OrderItemView;
        }),
        submittedAt: order.submittedAt,
        approvedAt: order.approvedAt,
        completedAt: order.completedAt,
        createdAt: order.createdAt,
        sellerCredentialId: order.sellerCredentialId,
      });
    }
    return views;
  }

  async listSaleViews(tenantId: string, filters: { sellerId?: string } = {}): Promise<SaleView[]> {
    const conditions = [`s.tenant_id = $1`];
    const params: unknown[] = [tenantId];
    if (filters.sellerId) {
      conditions.push(`s.seller_id = $${params.length + 1}`);
      params.push(filters.sellerId);
    }
    const { rows } = await this.pool.query(
      `select s.*, cu.name as customer_name, u.full_name as seller_name,
              (select source from orders o where o.tenant_id = s.tenant_id and o.id = s.order_id) as source
       from sales s left join customers cu on cu.tenant_id = s.tenant_id and cu.id = s.customer_id
       left join users u on u.tenant_id = s.tenant_id and u.id = s.seller_id
       where ${conditions.join(' and ')} order by s.created_at desc`,
      params,
    );
    const views: SaleView[] = [];
    for (const row of rows) {
      const record = row as Record<string, unknown>;
      const items = await this.pool.query(`select * from sale_items where tenant_id = $1 and sale_id = $2 order by created_at`, [
        tenantId, record.id as string,
      ]);
      const sale = mapSaleRow(record);
      views.push({
        id: sale.id,
        tenantId: sale.tenantId,
        orderId: sale.orderId,
        customerId: sale.customerId,
        customerName: (record.customer_name as string | null) ?? null,
        sellerId: sale.sellerId,
        sellerName: (record.seller_name as string | null) ?? null,
        status: sale.status as SaleView['status'],
        subtotal: sale.subtotal,
        total: sale.total,
        currencyCode: sale.currencyCode,
        source: (record.source as string | null) ?? 'STAFF',
        items: items.rows.map((item) => {
          const mapped = mapSaleItemRow(item as Record<string, unknown>);
          return {
            id: mapped.id, tenantId: mapped.tenantId, saleId: mapped.saleId, itemType: mapped.itemType,
            productId: mapped.productId, serviceId: mapped.serviceId, quantity: mapped.quantity,
            catalogUnitPrice: mapped.catalogUnitPrice, actualUnitPrice: mapped.actualUnitPrice,
            lineTotal: mapped.lineTotal, itemName: mapped.itemName, commissionType: mapped.commissionType,
            commissionValue: mapped.commissionValue, commissionAmount: mapped.commissionAmount,
            overrideReason: mapped.overrideReason, overrideHistoryUnknown: mapped.overrideHistoryUnknown,
          } as SaleItemView;
        }),
        completedAt: sale.completedAt,
        voidedAt: sale.voidedAt,
        voidReason: sale.voidReason,
        createdAt: sale.createdAt,
        sellerCredentialId: sale.sellerCredentialId,
        paymentMethod: sale.paymentMethod,
        customerPhone: sale.customerPhone,
      });
    }
    return views;
  }

  async getSellerSales(tenantId: string, sellerId: string) {
    const orders = await this.pool.query(
      `select * from orders where tenant_id = $1 and seller_id = $2 order by created_at desc`,
      [tenantId, sellerId],
    );
    const sales = await this.pool.query(
      `select * from sales where tenant_id = $1 and seller_id = $2 order by created_at desc`,
      [tenantId, sellerId],
    );
    return {
      orders: orders.rows.map((row) => mapOrderRow(row as Record<string, unknown>)),
      sales: sales.rows.map((row) => mapSaleRow(row as Record<string, unknown>)),
    };
  }

  async getAdminOrders(tenantId: string) {
    const { rows } = await this.pool.query(`select * from orders where tenant_id = $1 order by created_at desc`, [tenantId]);
    const orders: OpsOrder[] = [];
    for (const row of rows) {
      const found = await this.getOrderWithItems(tenantId, (row as Record<string, unknown>).id as string);
      if (found) {
        orders.push(found.order);
      }
    }
    return orders;
  }

  async listPayments(
    tenantId: string,
    filters: { orderId?: string; status?: PaymentStatus; needsRecovery?: boolean } = {},
  ) {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];
    if (filters.orderId) {
      conditions.push(`order_id = $${params.length + 1}`);
      params.push(filters.orderId);
    }
    if (filters.status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(filters.status);
    }
    if (filters.needsRecovery !== undefined) {
      conditions.push(`needs_recovery = $${params.length + 1}`);
      params.push(filters.needsRecovery);
    }
    const { rows } = await this.pool.query(
      `select * from payments where ${conditions.join(' and ')} order by created_at desc`,
      params,
    );
    return rows.map((row) => mapPaymentRow(row as Record<string, unknown>));
  }

  // ── payment connections (Phase 4B) ──

  async getConnectionById(tenantId: string, connectionId: string) {
    const { rows } = await this.pool.query(
      `select * from payment_connections where tenant_id = $1 and id = $2`,
      [tenantId, connectionId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? mapConnectionRow(row) : null;
  }

  async getActiveConnection(tenantId: string, environment?: PaymentConnectionEnvironment) {
    const conditions = [`tenant_id = $1`, `status = 'CONNECTED'`];
    const params: unknown[] = [tenantId];
    if (environment) {
      conditions.push(`environment = $2`);
      params.push(environment);
    }
    const { rows } = await this.pool.query(
      `select * from payment_connections where ${conditions.join(' and ')} order by connected_at desc limit 1`,
      params,
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? mapConnectionRow(row) : null;
  }

  async listConnections(tenantId: string) {
    const { rows } = await this.pool.query(
      `select * from payment_connections where tenant_id = $1 order by created_at desc`,
      [tenantId],
    );
    return rows.map((row) => mapConnectionRow(row as Record<string, unknown>));
  }

  async findConnectionByProviderTenantId(providerTenantId: string) {
    const { rows } = await this.pool.query(
      `select * from payment_connections where provider_tenant_id = $1 order by created_at desc limit 1`,
      [providerTenantId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? mapConnectionRow(row) : null;
  }

  async createConnection(
    input: {
      tenantId: string;
      provider: PaymentConnectionProvider;
      providerTenantId: string;
      environment: PaymentConnectionEnvironment;
      status: PaymentConnectionStatus;
      displayName?: string | null;
      supportedMethods: PaymentConnectionMethod[];
      secretSealed: string | null;
      webhookSecretSealed: string | null;
      connectedAt?: string | null;
      lastVerifiedAt?: string | null;
    },
    ctx: OpContext = {},
  ) {
    const now = nowISO(ctx);
    const id = newId(ctx);
    await this.pool.query(
      `insert into payment_connections
        (id, tenant_id, provider, provider_tenant_id, environment, status, display_name, supported_methods, connected_at, last_verified_at, secret_sealed, webhook_secret_sealed, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
      [
        id, input.tenantId, input.provider, input.providerTenantId, input.environment, input.status,
        input.displayName ?? null, input.supportedMethods, input.connectedAt ?? null,
        input.lastVerifiedAt ?? null, input.secretSealed, input.webhookSecretSealed, now,
      ],
    );
    const created = await this.pool.query(`select * from payment_connections where tenant_id = $1 and id = $2`, [input.tenantId, id]);
    return mapConnectionRow(created.rows[0] as Record<string, unknown>);
  }

  async updateConnection(
    input: {
      tenantId: string;
      connectionId: string;
      status?: PaymentConnectionStatus;
      displayName?: string | null;
      supportedMethods?: PaymentConnectionMethod[];
      secretSealed?: string | null;
      webhookSecretSealed?: string | null;
      connectedAt?: string | null;
      lastVerifiedAt?: string | null;
      disconnectedAt?: string | null;
      lastCheckCode?: string | null;
      lastCheckMessage?: string | null;
    },
    ctx: OpContext = {},
  ) {
    const now = nowISO(ctx);
    const setClauses: string[] = [`updated_at = $3`];
    const params: unknown[] = [input.tenantId, input.connectionId, now];
    const assign = (column: string, value: unknown) => {
      setClauses.push(`${column} = $${params.length + 1}`);
      params.push(value);
    };
    if (input.status !== undefined) assign('status', input.status);
    if (input.displayName !== undefined) assign('display_name', input.displayName);
    if (input.supportedMethods !== undefined) assign('supported_methods', input.supportedMethods);
    if (input.secretSealed !== undefined) assign('secret_sealed', input.secretSealed);
    if (input.webhookSecretSealed !== undefined) assign('webhook_secret_sealed', input.webhookSecretSealed);
    if (input.connectedAt !== undefined) assign('connected_at', input.connectedAt);
    if (input.lastVerifiedAt !== undefined) assign('last_verified_at', input.lastVerifiedAt);
    if (input.disconnectedAt !== undefined) assign('disconnected_at', input.disconnectedAt);
    if (input.lastCheckCode !== undefined) assign('last_check_code', input.lastCheckCode);
    if (input.lastCheckMessage !== undefined) assign('last_check_message', input.lastCheckMessage);
    const updated = await this.pool.query(
      `update payment_connections set ${setClauses.join(', ')} where tenant_id = $1 and id = $2 returning *`,
      params,
    );
    const row = updated.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      throw new PaymentConnectionError('connection-not-found', 'Payment connection not found for this shop.');
    }
    return mapConnectionRow(row);
  }
}

// ── row mappers (snake_case → ops) ───────────────────────────────────────────

function mapOrderRow(row: Record<string, unknown>): OpsOrder {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    customerId: (row.customer_id as string | null) ?? null,
    sellerId: (row.seller_id as string | null) ?? null,
    status: row.status as OpsOrder['status'],
    subtotal: toNumber(row.subtotal),
    total: toNumber(row.total),
    currencyCode: (row.currency_code as string | null) || 'KES',
    source: row.source as string,
    notes: (row.notes as string | null) ?? null,
    idempotencyKey: (row.idempotency_key as string | null) ?? null,
    quotedAt: row.quoted_at ? toISO(row.quoted_at) : null,
    submittedAt: row.submitted_at ? toISO(row.submitted_at) : null,
    approvedAt: row.approved_at ? toISO(row.approved_at) : null,
    approvedBy: (row.approved_by as string | null) ?? null,
    completedAt: row.completed_at ? toISO(row.completed_at) : null,
    cancelledAt: row.cancelled_at ? toISO(row.cancelled_at) : null,
    rejectedAt: row.rejected_at ? toISO(row.rejected_at) : null,
    rejectionReason: (row.rejection_reason as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    sellerCredentialId: (row.seller_credential_id as string | null) ?? null,
    paymentMethod: (row.payment_method as string | null) ?? null,
    customerPhone: (row.customer_phone as string | null) ?? null,
    createdAt: toISO(row.created_at),
    updatedAt: toISO(row.updated_at),
  };
}

function mapOrderItemRow(row: Record<string, unknown>): OpsOrderItem {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    orderId: row.order_id as string,
    itemType: row.item_type as 'PRODUCT' | 'SERVICE',
    productId: (row.product_id as string | null) ?? null,
    serviceId: (row.service_id as string | null) ?? null,
    quantity: Number(row.quantity),
    catalogUnitPrice: toNumber(row.catalog_unit_price),
    actualUnitPrice: toNumber(row.actual_unit_price),
    lineTotal: toNumber(row.line_total),
    itemName: row.item_name as string,
    itemSnapshot: (row.item_snapshot as Record<string, unknown> | null) ?? {},
    commissionType: (row.commission_type as 'fixed' | 'percentage' | null) ?? 'percentage',
    commissionValue: toNumber(row.commission_value ?? 0),
    commissionAmount: toNumber(row.commission_amount ?? 0),
    overrideReason: (row.override_reason as string | null) ?? null,
    overrideBy: (row.override_by as string | null) ?? null,
    overrideAt: row.override_at ? toISO(row.override_at) : null,
    createdAt: toISO(row.created_at),
  };
}

function mapSaleRow(row: Record<string, unknown>): OpsSale {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    orderId: row.order_id as string,
    customerId: (row.customer_id as string | null) ?? null,
    sellerId: (row.seller_id as string | null) ?? null,
    status: row.status as OpsSale['status'],
    subtotal: toNumber(row.subtotal),
    total: toNumber(row.total),
    currencyCode: (row.currency_code as string | null) || 'KES',
    idempotencyKey: (row.idempotency_key as string | null) ?? null,
    approvedAt: row.approved_at ? toISO(row.approved_at) : null,
    approvedBy: (row.approved_by as string | null) ?? null,
    completedAt: row.completed_at ? toISO(row.completed_at) : null,
    recordedBy: (row.recorded_by as string | null) ?? null,
    voidedAt: row.voided_at ? toISO(row.voided_at) : null,
    voidedBy: (row.voided_by as string | null) ?? null,
    voidReason: (row.void_reason as string | null) ?? null,
    sellerCredentialId: (row.seller_credential_id as string | null) ?? null,
    paymentMethod: (row.payment_method as string | null) ?? null,
    customerPhone: (row.customer_phone as string | null) ?? null,
    createdAt: toISO(row.created_at),
    updatedAt: toISO(row.updated_at),
  };
}

function mapSaleItemRow(row: Record<string, unknown>): OpsSaleItem {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    saleId: row.sale_id as string,
    itemType: row.item_type as 'PRODUCT' | 'SERVICE',
    productId: (row.product_id as string | null) ?? null,
    serviceId: (row.service_id as string | null) ?? null,
    quantity: Number(row.quantity),
    catalogUnitPrice: toNumber(row.catalog_unit_price),
    actualUnitPrice: toNumber(row.actual_unit_price),
    lineTotal: toNumber(row.line_total),
    itemName: row.item_name as string,
    itemSnapshot: (row.item_snapshot as Record<string, unknown> | null) ?? {},
    commissionType: (row.commission_type as 'fixed' | 'percentage' | null) ?? 'percentage',
    commissionValue: toNumber(row.commission_value ?? 0),
    commissionAmount: toNumber(row.commission_amount ?? 0),
    overrideReason: (row.override_reason as string | null) ?? null,
    overrideBy: (row.override_by as string | null) ?? null,
    overrideAt: row.override_at ? toISO(row.override_at) : null,
    overrideHistoryUnknown: (row.override_history_unknown as boolean | null) ?? false,
    createdAt: toISO(row.created_at),
  };
}

function mapPaymentRow(row: Record<string, unknown>): OpsPayment {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    orderId: (row.order_id as string | null) ?? null,
    saleId: (row.sale_id as string | null) ?? null,
    provider: row.provider as PaymentProvider,
    method: row.method as PaymentMethod,
    status: row.status as PaymentStatus,
    amount: toNumber(row.amount),
    currencyCode: (row.currency_code as string | null) || 'KES',
    customerPhone: (row.customer_phone as string | null) ?? null,
    providerReference: (row.provider_reference as string | null) ?? null,
    providerRequestId: (row.provider_request_id as string | null) ?? null,
    idempotencyKey: (row.idempotency_key as string | null) ?? null,
    attemptNumber: Number(row.attempt_number ?? 1),
    initiatedAt: toISO(row.initiated_at),
    confirmedAt: row.confirmed_at ? toISO(row.confirmed_at) : null,
    failedAt: row.failed_at ? toISO(row.failed_at) : null,
    expiresAt: row.expires_at ? toISO(row.expires_at) : null,
    failureCode: (row.failure_code as string | null) ?? null,
    failureReason: (row.failure_reason as string | null) ?? null,
    needsRecovery: (row.needs_recovery as boolean | null) ?? false,
    recoveryReason: (row.recovery_reason as string | null) ?? null,
    connection: row.payment_connection_id
      ? { connectionId: row.payment_connection_id as string, providerMerchantId: (row.provider_merchant_id as string | null) ?? null }
      : null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: toISO(row.created_at),
    updatedAt: toISO(row.updated_at),
  };
}

function mapConnectionRow(row: Record<string, unknown>): OpsPaymentConnection {
  const methods = Array.isArray(row.supported_methods) ? (row.supported_methods as string[]) : [];
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    provider: row.provider as PaymentConnectionProvider,
    providerTenantId: (row.provider_tenant_id as string | null) ?? null,
    environment: row.environment as PaymentConnectionEnvironment,
    status: row.status as PaymentConnectionStatus,
    displayName: (row.display_name as string | null) ?? null,
    supportedMethods: methods as PaymentConnectionMethod[],
    connectedAt: row.connected_at ? toISO(row.connected_at) : null,
    lastVerifiedAt: row.last_verified_at ? toISO(row.last_verified_at) : null,
    disconnectedAt: row.disconnected_at ? toISO(row.disconnected_at) : null,
    lastCheckCode: (row.last_check_code as string | null) ?? null,
    lastCheckMessage: (row.last_check_message as string | null) ?? null,
    secretSealed: (row.secret_sealed as string | null) ?? null,
    webhookSecretSealed: (row.webhook_secret_sealed as string | null) ?? null,
    createdAt: toISO(row.created_at),
    updatedAt: toISO(row.updated_at),
  };
}
