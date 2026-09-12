/**
 * Commerce repository contract (Phase 4).
 *
 * Domain service
 *      ↓
 * CommerceRepository (this interface — business operations, no SQL here)
 *   ┌──────┴────────┐
 *   │               │
 * SQL DAL        File adapter (dev/compat)
 *
 * Rules:
 * - Business logic lives ABOVE the adapters (pure domain modules +
 *   operation functions). Adapters own transactions and row mapping only.
 * - Routes/actions depend on this interface via getCommerceRepository();
 *   they never touch SQL, pools, or the JSON document directly.
 * - The file adapter preserves current behavior for local development.
 *   SQL is authoritative in production. Parity is verified, not assumed.
 */

import type {
  ActorRole,
  CreateOrderInput,
  OpContext,
  OpsMovement,
  OpsOrder,
  OpsOrderItem,
  OpsSale,
  OpsSaleItem,
} from './commerce-store.ts';
import type { InventoryMovementType } from './inventory.ts';
import type { PaymentMethod, PaymentProvider, PaymentStatus } from './payments.ts';

export type { CreateOrderInput };
export type { OpContext };

export type OpsPayment = {
  id: string;
  tenantId: string;
  orderId?: string | null;
  saleId?: string | null;
  provider: PaymentProvider;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  currencyCode: string;
  customerPhone?: string | null;
  providerReference?: string | null;
  providerRequestId?: string | null;
  idempotencyKey?: string | null;
  attemptNumber: number;
  initiatedAt: string;
  confirmedAt?: string | null;
  failedAt?: string | null;
  expiresAt?: string | null;
  failureCode?: string | null;
  failureReason?: string | null;
  needsRecovery?: boolean;
  recoveryReason?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OpsCatalogProduct = {
  id: string;
  tenantId: string;
  name: string;
  sellingPrice: number | null;
  unitCost: number;
  sku: string | null;
  quantityOnHand: number;
  reorderLevel: number | null;
  criticalLevel: number | null;
  isActive: boolean;
};

export type OpsCatalogService = {
  id: string;
  tenantId: string;
  name: string;
  price: number;
  durationMinutes?: number;
  commissionType: 'fixed' | 'percentage';
  commissionValue: number;
  isActive: boolean;
};

export type OpsTenantPolicy = {
  orderReviewRequired: boolean;
  timezone: string;
  currencyCode: string;
  slug: string;
  name: string;
};

export type OpsSellerContext = {
  tenantId: string;
  sellerId: string;
  credentialId: string;
  publicReference: string;
};

export type CreatePaymentInput = {
  tenantId: string;
  orderId?: string | null;
  saleId?: string | null;
  provider: PaymentProvider;
  method: PaymentMethod;
  amount: number;
  currencyCode: string;
  customerPhone?: string | null;
  providerRequestId?: string | null;
  providerReference?: string | null;
  idempotencyKey: string;
  attemptNumber: number;
  expiresAt?: string | null;
  createdBy?: string | null;
};

export type TransitionPaymentInput = {
  tenantId: string;
  paymentId: string;
  to: PaymentStatus;
  providerReference?: string | null;
  reportedAmount?: number | null;
  reportedCurrency?: string | null;
  failureCode?: string | null;
  failureReason?: string | null;
};

export type PostMovementInput = {
  tenantId: string;
  productId: string;
  type: InventoryMovementType;
  quantity: number;
  referenceType?: string | null;
  referenceId?: string | null;
  unitCost?: number | null;
  reason?: string | null;
  createdBy?: string | null;
};

export interface CommerceRepository {
  readonly backend: 'sql' | 'file';

  // ── catalog / policy ──
  getTenantPolicy(tenantId: string): Promise<OpsTenantPolicy>;
  getCatalogProducts(tenantId: string): Promise<OpsCatalogProduct[]>;
  getCatalogServices(tenantId: string): Promise<OpsCatalogService[]>;
  getProductBalance(tenantId: string, productId: string): Promise<number>;

  // ── orders / sales (pass-through op semantics, adapter transactions) ──
  createOrder(input: CreateOrderInput, ctx?: OpContext): Promise<{ order: OpsOrder; items: OpsOrderItem[]; duplicate: boolean }>;
  submitOrder(
    input: { tenantId: string; orderId: string; actorId: string; actorRole: ActorRole; orderReviewRequired: boolean; forceReview?: boolean },
    ctx?: OpContext,
  ): Promise<{ order: OpsOrder; route: 'PENDING_REVIEW' | 'AUTO_APPROVE' }>;
  approveOrder(
    input: { tenantId: string; orderId: string; actorId: string; actorRole: ActorRole },
    ctx?: OpContext,
  ): Promise<{ order: OpsOrder; sale: OpsSale; duplicate: boolean }>;
  finalizeApprovedOrder(
    input: { tenantId: string; orderId: string; actorId: string },
    ctx?: OpContext,
  ): Promise<{ order: OpsOrder; sale: OpsSale; duplicate: boolean }>;
  rejectOrder(
    input: { tenantId: string; orderId: string; actorId: string; actorRole: ActorRole; reason?: string | null },
    ctx?: OpContext,
  ): Promise<OpsOrder>;
  cancelOrder(input: { tenantId: string; orderId: string }, ctx?: OpContext): Promise<OpsOrder>;
  voidSale(
    input: { tenantId: string; saleId: string; actorId: string; actorRole: ActorRole; reason?: string | null },
    ctx?: OpContext,
  ): Promise<{ sale: OpsSale; reversals: OpsMovement[] }>;
  amendLinkedSale(
    input: {
      tenantId: string;
      legacyRecordId: string;
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
    ctx?: OpContext,
  ): Promise<{ amended: boolean; sale: OpsSale | null; stockSynced?: boolean }>;
  getOrderWithItems(tenantId: string, orderId: string): Promise<{ order: OpsOrder; items: OpsOrderItem[] } | null>;
  getSaleWithItems(tenantId: string, saleId: string): Promise<{ sale: OpsSale; items: OpsSaleItem[] } | null>;

  // ── inventory (single engine, both adapters) ──
  postInventoryMovement(input: PostMovementInput, ctx?: OpContext): Promise<OpsMovement>;
  postOpeningBalance(
    input: Omit<PostMovementInput, 'type' | 'quantity'> & { quantity: number },
    ctx?: OpContext,
  ): Promise<OpsMovement>;
  adjustProductStock(
    input: { tenantId: string; productId: string; countedQuantity: number; reason?: string | null; createdBy?: string | null },
    ctx?: OpContext,
  ): Promise<OpsMovement>;
  consumeServiceBom(
    tenantId: string,
    serviceId: string,
    times: number,
    reference: { referenceType: string; referenceId: string; createdBy?: string | null },
  ): Promise<OpsMovement[]>;

  // ── payments ──
  createPayment(input: CreatePaymentInput, ctx?: OpContext): Promise<{ payment: OpsPayment; duplicate: boolean }>;
  transitionPayment(input: TransitionPaymentInput, ctx?: OpContext): Promise<{ payment: OpsPayment; duplicate: boolean }>;
  getPaymentByIdempotency(tenantId: string, key: string): Promise<OpsPayment | null>;
  getPaymentByProviderRequest(tenantId: string, providerRequestId: string): Promise<OpsPayment | null>;
  getPaymentsByOrder(tenantId: string, orderId: string): Promise<OpsPayment[]>;
  markPaymentRecovery(tenantId: string, paymentId: string, reason: string, ctx?: OpContext): Promise<OpsPayment>;

  // ── credentials / reads ──
  verifySellerCredential(tenantId: string, reference: unknown, bearer: unknown, ctx?: OpContext): Promise<OpsSellerContext>;
  touchSellerCredentialUsed(tenantId: string, credentialId: string, ctx?: OpContext): Promise<void>;
  getSellerSales(tenantId: string, sellerId: string): Promise<{ orders: OpsOrder[]; sales: OpsSale[] }>;
  getAdminOrders(tenantId: string): Promise<OpsOrder[]>;
  listPayments(tenantId: string, filters?: { orderId?: string; status?: PaymentStatus; needsRecovery?: boolean }): Promise<OpsPayment[]>;
}
