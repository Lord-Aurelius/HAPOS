import type {
  BillingPeriod,
  CommissionType,
  CustomerOrderStatus,
  LoyaltyRewardType,
  MarketplaceAdStatus,
  SmsStatus,
  SubscriptionStatus,
  TenantStatus,
  UserRole,
} from '@/lib/types';

export type StoredPassword = {
  salt: string;
  hash: string;
};

export type StoreLoyaltyProgram = {
  isEnabled: boolean;
  spendThreshold: number;
  rewardType: LoyaltyRewardType;
  rewardValue: number;
  rewardLabel?: string | null;
  notes?: string | null;
};

export type StoreTenant = {
  id: string;
  name: string;
  ownerName?: string | null;
  slug: string;
  logoUrl?: string | null;
  motto?: string | null;
  address?: string | null;
  storeNumber?: string | null;
  timezone: string;
  countryCode: string;
  currencyCode: string;
  status: TenantStatus;
  suspensionReason?: string | null;
  loyaltyProgram?: StoreLoyaltyProgram | null;
  /** Phase 2 merchant policy: customer bookings require review (default true). */
  orderReviewRequired?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StoreUser = {
  id: string;
  tenantId: string | null;
  role: UserRole;
  fullName: string;
  username: string;
  email: string;
  phone?: string;
  password: StoredPassword;
  passwordUpdatedAt?: string | null;
  /** Phase 2A reusable employee identity (terminal input). Null until assigned. */
  employeeNumber?: string | null;
  isActive: boolean;
  commissionType?: CommissionType;
  commissionValue?: number;
  commissionNotes?: string;
  createdAt: string;
  updatedAt: string;
};

export type StoreCustomer = {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  phoneE164: string;
  notes?: string;
  marketingOptIn: boolean;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoreService = {
  id: string;
  tenantId: string;
  name: string;
  price: number;
  description?: string;
  imageUrl?: string | null;
  commissionType: CommissionType;
  commissionValue: number;
  durationMinutes?: number;
  isActive: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type StoreProduct = {
  id: string;
  tenantId: string;
  name: string;
  unitCost: number;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  // ── Phase 1 catalog projection (transitional file-mode mirror of the
  // authoritative SQL columns in db/migrations/phase-01-catalog-inventory.sql).
  // `sellingPrice: null` means `needs_pricing`; `quantityOnHand: 0` on legacy
  // rows means `uncounted`, never inferred. Optional so migrateStoreState can
  // backfill legacy snapshots (same convention as correctedAt/voided*).
  // Removal milestone: Phase 2/3 SQL cutover (see docs/phase-0-persistence-decision.md).
  sku?: string | null;
  skuGenerated?: boolean;
  sellingPrice?: number | null;
  quantityOnHand?: number;
  reorderLevel?: number | null;
  criticalLevel?: number | null;
};

export type StoreServiceProductLink = {
  id: string;
  tenantId: string;
  serviceId: string;
  productId: string;
  quantity: number;
  createdAt: string;
};

export type StoreInventoryMovement = {
  id: string;
  tenantId: string;
  productId: string;
  quantity: number;
  movementType: string;
  referenceType?: string | null;
  referenceId?: string | null;
  unitCost?: number | null;
  previousQuantity: number;
  resultingQuantity: number;
  reason?: string | null;
  createdBy?: string | null;
  createdAt: string;
};

export type StoreProductUsage = {
  productId: string;
  quantity: number;
  unitCost: number;
};

export type StoreServiceRecord = {
  id: string;
  tenantId: string;
  customerId: string;
  staffId: string;
  serviceId?: string | null;
  serviceName: string;
  isCustomService: boolean;
  price: number;
  description?: string;
  commissionType: CommissionType;
  commissionValue: number;
  commissionAmount: number;
  productUsages: StoreProductUsage[];
  performedAt: string;
  recordedBy: string;
  correctedAt?: string | null;
  correctedBy?: string | null;
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidReason?: string | null;
  /**
   * Phase 0.4 server-side idempotency key. Unique per tenant for records
   * created after Phase 0; legacy records backfill to `null` (no key).
   */
  idempotencyKey?: string | null;
  /**
   * Phase 2 link to the canonical engine sale co-written by salon flows.
   * Null for legacy-only rows and pre-Phase-2 history.
   */
  commerceSaleId?: string | null;
  createdAt: string;
};

export type StoreExpense = {
  id: string;
  tenantId: string;
  category: string;
  description?: string;
  amount: number;
  expenseDate: string;
  createdBy: string;
  createdAt: string;
};

export type StoreSubscription = {
  id: string;
  tenantId: string;
  packageId?: string | null;
  planCode: string;
  status: SubscriptionStatus;
  startsAt: string;
  endsAt: string;
  graceEndsAt?: string | null;
  amount: number;
  currencyCode: string;
  autoRenew: boolean;
  paymentTerms?: string;
  updatedAt: string;
};

export type StoreSubscriptionPackage = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  features: string[];
  amount: number;
  currencyCode: string;
  billingPeriod: BillingPeriod;
  includesMarketplace: boolean;
  includesCustomerMarketplace: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StoreSmsLog = {
  id: string;
  tenantId: string;
  customerId?: string;
  smsType: 'thank_you' | 'promotion' | 'system';
  recipientPhone: string;
  message: string;
  status: SmsStatus;
  sentAt?: string | null;
  createdAt: string;
};

export type StoreCommissionPayout = {
  id: string;
  tenantId: string;
  staffId: string;
  amount: number;
  periodStart: string;
  periodEnd: string;
  paidAt?: string | null;
  createdAt: string;
};

export type StoreSession = {
  id: string;
  userId: string;
  tenantId: string | null;
  role: UserRole;
  expiresAt: string;
  createdAt: string;
};

export type StoreCustomerSession = {
  id: string;
  customerId: string;
  tenantId: string;
  expiresAt: string;
  createdAt: string;
};

export type StoreMarketplaceAd = {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  contactName: string;
  contactPhone: string;
  imageUrl?: string | null;
  status: MarketplaceAdStatus;
  approvalNotes?: string | null;
  createdBy: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoreCustomerOrder = {
  id: string;
  tenantId: string;
  customerId: string;
  serviceId: string;
  serviceName: string;
  quotedPrice: number;
  requestedStaffId?: string | null;
  requestedName: string;
  requestedPhone: string;
  notes?: string;
  status: CustomerOrderStatus;
  requestedAt: string;
  statusUpdatedAt?: string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  approvedRecordId?: string | null;
  createdAt: string;
};

// ── Phase 2 commerce entities (transitional file projection of
// db/migrations/phase-02-orders-sales.sql; SQL-authoritative at cutover) ─────

export type StoreOrderItem = {
  id: string;
  tenantId: string;
  orderId: string;
  itemType: 'PRODUCT' | 'SERVICE';
  productId?: string | null;
  serviceId?: string | null;
  quantity: number;
  catalogUnitPrice: number;
  actualUnitPrice: number;
  lineTotal: number;
  itemName: string;
  itemSnapshot?: Record<string, unknown>;
  commissionType?: 'fixed' | 'percentage';
  commissionValue?: number;
  commissionAmount?: number;
  overrideReason?: string | null;
  overrideBy?: string | null;
  overrideAt?: string | null;
  createdAt: string;
};

export type StoreOrder = {
  id: string;
  tenantId: string;
  customerId?: string | null;
  sellerId?: string | null;
  status: string;
  subtotal: number;
  total: number;
  currencyCode: string;
  source: string;
  notes?: string | null;
  idempotencyKey?: string | null;
  quotedAt?: string | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  createdBy?: string | null;
  /** Phase 3 audit link: credential that created the order (null otherwise). */
  sellerCredentialId?: string | null;
  /** Phase 3 payment intent (CASH | MPESA | null). */
  paymentMethod?: string | null;
  customerPhone?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoreSaleItem = {
  id: string;
  tenantId: string;
  saleId: string;
  itemType: 'PRODUCT' | 'SERVICE';
  productId?: string | null;
  serviceId?: string | null;
  quantity: number;
  catalogUnitPrice: number;
  actualUnitPrice: number;
  lineTotal: number;
  itemName: string;
  itemSnapshot?: Record<string, unknown>;
  commissionType?: 'fixed' | 'percentage';
  commissionValue?: number;
  commissionAmount?: number;
  overrideReason?: string | null;
  overrideBy?: string | null;
  overrideAt?: string | null;
  overrideHistoryUnknown?: boolean;
  createdAt: string;
};

export type StoreSale = {
  id: string;
  tenantId: string;
  orderId: string;
  customerId?: string | null;
  sellerId?: string | null;
  status: string;
  subtotal: number;
  total: number;
  currencyCode: string;
  idempotencyKey?: string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  completedAt?: string | null;
  recordedBy?: string | null;
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidReason?: string | null;
  /** Phase 3 audit link: credential that created the sale (null otherwise). */
  sellerCredentialId?: string | null;
  paymentMethod?: string | null;
  customerPhone?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoreAttendanceTerminal = {
  id: string;
  tenantId: string;
  reference: string;
  tokenHash: string;
  /** AES-GCM sealed token for persistent renders (null until keyed rotation). */
  tokenWrapped?: string | null;
  isActive: boolean;
  revokedAt?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoreAttendanceRecord = {
  id: string;
  tenantId: string;
  employeeId: string;
  employeeNumberSnapshot: string;
  attendanceDate: string;
  checkInAt: string;
  checkOutAt?: string | null;
  status: string;
  terminalReference?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoreSellerCredential = {
  id: string;
  tenantId: string;
  sellerId: string;
  publicReference: string;
  tokenHash: string;
  /** AES-GCM sealed bearer for persistent renders (null until keyed rotation). */
  bearerWrapped?: string | null;
  status: string;
  issuedAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  expiresAt?: string | null;
  rotatedAt?: string | null;
  rotatedFromId?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoreSaleAmendment = {
  id: string;
  tenantId: string;
  saleId: string;
  previousTotal: number;
  newTotal: number;
  fieldChanges?: { field: string; previous: unknown; current: unknown }[];
  reason: string;
  actorId?: string | null;
  createdAt: string;
};

export type StoreState = {
  tenants: StoreTenant[];
  users: StoreUser[];
  customers: StoreCustomer[];
  services: StoreService[];
  products: StoreProduct[];
  serviceRecords: StoreServiceRecord[];
  expenses: StoreExpense[];
  subscriptionPackages: StoreSubscriptionPackage[];
  subscriptions: StoreSubscription[];
  smsLogs: StoreSmsLog[];
  commissionPayouts: StoreCommissionPayout[];
  sessions: StoreSession[];
  customerSessions: StoreCustomerSession[];
  marketplaceAds: StoreMarketplaceAd[];
  customerOrders: StoreCustomerOrder[];
  // Phase 1 transitional projections (SQL-authoritative; see types above).
  serviceProductLinks: StoreServiceProductLink[];
  inventoryMovements: StoreInventoryMovement[];
  // Phase 2 transitional projections (SQL-authoritative; see types above).
  orders: StoreOrder[];
  orderItems: StoreOrderItem[];
  sales: StoreSale[];
  saleItems: StoreSaleItem[];
  // Phase 2A transitional projections (SQL-authoritative; see types above).
  // Terminal rows carry tokenHash only — plaintext tokens are shown once at
  // (re)generation and never persisted (both backends).
  attendanceTerminals: StoreAttendanceTerminal[];
  attendanceRecords: StoreAttendanceRecord[];
  // Phase 3 transitional projections (SQL-authoritative; see types above).
  // Credential rows carry tokenHash only — same one-time-bearer ceremony.
  sellerCredentials: StoreSellerCredential[];
  saleAmendments: StoreSaleAmendment[];
};
