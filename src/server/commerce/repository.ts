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
import type {
  Order as OrderView,
  OrderItem as OrderItemView,
  Sale as SaleView,
  SaleItem as SaleItemView,
} from '@/lib/types';
import type { InventoryMovementType } from './inventory.ts';
import type { PaymentMethod, PaymentProvider, PaymentStatus } from './payments.ts';
import type {
  OpsPaymentConnection,
  OpsPaymentConnectionEvent,
  PaymentConnectionEnvironment,
  PaymentConnectionEventAction,
  PaymentConnectionMethod,
  PaymentConnectionProvider,
  PaymentConnectionStatus,
} from '@/server/payments/connection.ts';

export type { CreateOrderInput };
export type { OpContext };
export type {
  OpsMovement,
  OpsOrder,
  OpsOrderItem,
  OpsSale,
  OpsSaleItem,
} from './commerce-store.ts';

/**
 * Input for recording a connection snapshot on a payment at initiation.
 * The snapshot keeps historical payments understandable even after the
 * connection is later disconnected or replaced.
 */
export type { OpsPaymentConnectionEvent } from '@/server/payments/connection.ts';
export type { PaymentConnectionEventAction } from '@/server/payments/connection.ts';

export type OpsPaymentConnectionSnapshot = {
  connectionId: string;
  providerMerchantId: string | null;
};

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
  /** Phase 4B: the connection (+ merchant snapshot) that produced this payment. */
  connection?: OpsPaymentConnectionSnapshot | null;
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
  sellerName?: string | null;
};

export type CreatePaymentInput = {
  /** Phase 4B: connection that produced this payment (snapshot persisted). */
  connection?: OpsPaymentConnectionSnapshot | null;
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
  amendSale(
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
  /**
   * Exceptional lookup for provider callbacks, which correlate by request id
   * before the tenant is known. Callers must verify authenticity first and
   * scope everything else to the returned row's tenant.
   */
  getPaymentByProviderRequestGlobal(providerRequestId: string): Promise<OpsPayment | null>;
  /**
   * Exceptional lookup for provider callbacks (correlated by ?pid= before
   * signature verification scopes everything to the row's tenant).
   */
  getPaymentByIdGlobal(paymentId: string): Promise<OpsPayment | null>;
  updatePaymentProviderDetails(
    input: { tenantId: string; paymentId: string; providerRequestId?: string | null; providerReference?: string | null; expiresAt?: string | null },
    ctx?: OpContext,
  ): Promise<OpsPayment>;
  /**
   * Atomic paid-order completion: order APPROVED (if needed) + sale
   * finalized with stock + payment linked. On stock failure the payment is
   * flagged needs_recovery and the outcome reports it (never partial).
   */
  completePaidOrder(
    input: { tenantId: string; orderId: string; paymentId: string; actorId: string },
    ctx?: OpContext,
  ): Promise<{ order: OpsOrder; sale: OpsSale; payment: OpsPayment; outcome: 'completed' | 'needs-recovery' }>;
  /** Retry completion for a SUCCESS payment flagged needs_recovery. */
  recoverPaidOrder(
    input: { tenantId: string; paymentId: string; actorId: string },
    ctx?: OpContext,
  ): Promise<{ order: OpsOrder; sale: OpsSale; payment: OpsPayment }>;
  getPaymentsByOrder(tenantId: string, orderId: string): Promise<OpsPayment[]>;
  markPaymentRecovery(tenantId: string, paymentId: string, reason: string, ctx?: OpContext): Promise<OpsPayment>;
  // ── enriched views (presentation; names resolved adapter-side) ──
  getOrderView(tenantId: string, orderId: string): Promise<OrderView | null>;
  getSaleView(tenantId: string, saleId: string): Promise<SaleView | null>;
  listOrderViews(tenantId: string, filters?: { sellerId?: string }): Promise<OrderView[]>;
  listSaleViews(tenantId: string, filters?: { sellerId?: string }): Promise<SaleView[]>;
  // ── credentials / reads ──
  verifySellerCredential(tenantId: string, reference: unknown, bearer: unknown, ctx?: OpContext): Promise<OpsSellerContext>;
  touchSellerCredentialUsed(tenantId: string, credentialId: string, ctx?: OpContext): Promise<void>;
  /** Resolve the owning tenant of a credential reference (public QR entry). */
  resolveSellerCredentialTenant(reference: string): Promise<string | null>;
  getSellerSales(tenantId: string, sellerId: string): Promise<{ orders: OpsOrder[]; sales: OpsSale[] }>;
  getAdminOrders(tenantId: string): Promise<OpsOrder[]>;
  listPayments(tenantId: string, filters?: { orderId?: string; status?: PaymentStatus; needsRecovery?: boolean }): Promise<OpsPayment[]>;

  // ── payment connections (Phase 4B) ──
  getConnectionById(tenantId: string, connectionId: string): Promise<OpsPaymentConnection | null>;
  /** The active connection for a tenant+environment; null when none is CONNECTED. */
  getActiveConnection(tenantId: string, environment?: PaymentConnectionEnvironment): Promise<OpsPaymentConnection | null>;
  listConnections(tenantId: string): Promise<OpsPaymentConnection[]>;
  /** Find a connection by provider tenant id across ALL tenants (connect flow dedup). */
  findConnectionByProviderTenantId(providerTenantId: string): Promise<OpsPaymentConnection | null>;
  createConnection(
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
    ctx?: OpContext,
  ): Promise<OpsPaymentConnection>;
  updateConnection(
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
    ctx?: OpContext,
  ): Promise<OpsPaymentConnection>;

  // ── connection lifecycle audit (Phase 4B closure) ──
  // (event type re-exported below)
  recordConnectionEvent(
    input: {
      tenantId: string;
      connectionId?: string | null;
      action: PaymentConnectionEventAction;
      actorId?: string | null;
      actorRole?: string | null;
      result?: 'OK' | 'ERROR';
      oldProviderReference?: string | null;
      newProviderReference?: string | null;
    },
    ctx?: OpContext,
  ): Promise<OpsPaymentConnectionEvent>;
  /** Newest first. Tenant-scoped. */
  listConnectionEvents(tenantId: string, filters?: { connectionId?: string; limit?: number }): Promise<OpsPaymentConnectionEvent[]>;
  /**
   * Platform support surface: every tenant's connections + latest event.
   * Metadata only — the repository strips sealed material by construction.
   */
  listAllConnectionsForAudit(): Promise<OpsPaymentConnection[]>;
}
