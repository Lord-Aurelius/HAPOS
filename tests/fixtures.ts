/**
 * Phase 0 test fixtures (node:test, no Next.js runtime).
 *
 * Factories return plain objects that are structurally compatible with the
 * corresponding `Store*` types. They intentionally do NOT import `@/*`
 * aliases (which plain `node --test` cannot resolve) — compatibility is
 * enforced by the type assertions at each use site in the app code, and by
 * keeping field names identical to `src/server/store/types.ts`.
 */

export const FIXED_NOW = '2026-04-04T09:00:00.000Z';

let sequence = 0;

export function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-test-${sequence}`;
}

export function resetFixtureSequence() {
  sequence = 0;
}

export function makeTenant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tenant-test-shop',
    name: 'Test Shop',
    ownerName: 'Test Owner',
    slug: 'test-shop',
    logoUrl: null,
    motto: null,
    address: null,
    storeNumber: null,
    timezone: 'Africa/Nairobi',
    countryCode: 'KE',
    currencyCode: 'KES',
    status: 'active',
    suspensionReason: null,
    loyaltyProgram: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

export function makeStaffUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-test-staff',
    tenantId: 'tenant-test-shop',
    role: 'staff',
    fullName: 'Test Staff',
    username: 'teststaff',
    email: 'staff@test.shop',
    phone: '+254700000001',
    password: { salt: 'salt', hash: 'hash' },
    passwordUpdatedAt: FIXED_NOW,
    isActive: true,
    commissionType: 'percentage',
    commissionValue: 10,
    commissionNotes: '',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

export function makeShopAdmin(overrides: Record<string, unknown> = {}) {
  return makeStaffUser({
    id: 'user-test-admin',
    role: 'shop_admin',
    fullName: 'Test Admin',
    username: 'testadmin',
    email: 'admin@test.shop',
    ...overrides,
  });
}

export function makeCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'customer-test-1',
    tenantId: 'tenant-test-shop',
    name: 'Test Customer',
    phone: '+254711000101',
    phoneE164: '+254711000101',
    notes: '',
    marketingOptIn: true,
    archivedAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

export function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-test-1',
    tenantId: 'tenant-test-shop',
    name: 'Test Product',
    unitCost: 250,
    description: '',
    isActive: true,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

export function makeService(overrides: Record<string, unknown> = {}) {
  return {
    id: 'service-test-1',
    tenantId: 'tenant-test-shop',
    name: 'Test Service',
    price: 1000,
    description: '',
    imageUrl: null,
    commissionType: 'percentage',
    commissionValue: 10,
    durationMinutes: 30,
    isActive: true,
    createdBy: 'user-test-admin',
    updatedBy: 'user-test-admin',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

export type TestRecordOverrides = Record<string, unknown>;

export type TestServiceRecord = {
  id: string;
  tenantId: string;
  customerId: string;
  staffId: string;
  serviceId: string | null;
  serviceName: string;
  isCustomService: boolean;
  price: number;
  description: string;
  commissionType: string;
  commissionValue: number;
  commissionAmount: number;
  productUsages: { productId: string; quantity: number; unitCost: number }[];
  performedAt: string;
  recordedBy: string;
  correctedAt: string | null;
  correctedBy: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  idempotencyKey: string | null;
  createdAt: string;
};

export type TestCustomerOrder = {
  id: string;
  tenantId: string;
  customerId: string;
  serviceId: string;
  serviceName: string;
  quotedPrice: number;
  requestedStaffId: string | null;
  requestedName: string;
  requestedPhone: string;
  notes: string;
  status: string;
  requestedAt: string;
  statusUpdatedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  approvedRecordId: string | null;
  createdAt: string;
};

export type TestStore = {
  tenants: Record<string, unknown>[];
  users: Record<string, unknown>[];
  customers: Record<string, unknown>[];
  services: Record<string, unknown>[];
  products: Record<string, unknown>[];
  serviceRecords: TestServiceRecord[];
  customerOrders: TestCustomerOrder[];
  smsLogs: Record<string, unknown>[];
};

export function makeServiceRecord(overrides: TestRecordOverrides = {}): TestServiceRecord {
  return {
    id: nextId('record'),
    tenantId: 'tenant-test-shop',
    customerId: 'customer-test-1',
    staffId: 'user-test-staff',
    serviceId: 'service-test-1',
    serviceName: 'Test Service',
    isCustomService: false,
    price: 1000,
    description: '',
    commissionType: 'percentage',
    commissionValue: 10,
    commissionAmount: 100,
    productUsages: [],
    performedAt: FIXED_NOW,
    recordedBy: 'user-test-staff',
    correctedAt: null,
    correctedBy: null,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    idempotencyKey: null,
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

export function makeCustomerOrder(overrides: TestRecordOverrides = {}): TestCustomerOrder {
  return {
    id: nextId('order'),
    tenantId: 'tenant-test-shop',
    customerId: 'customer-test-1',
    serviceId: 'service-test-1',
    serviceName: 'Test Service',
    quotedPrice: 1000,
    requestedStaffId: 'user-test-staff',
    requestedName: 'Test Customer',
    requestedPhone: '+254711000101',
    notes: '',
    status: 'pending',
    requestedAt: FIXED_NOW,
    statusUpdatedAt: null,
    approvedAt: null,
    approvedBy: null,
    approvedRecordId: null,
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

/** Minimal in-memory store carrying only the collections Phase 0 tests need. */
export function makeTestStore(overrides: Partial<TestStore> = {}): TestStore {
  return {
    tenants: [makeTenant()],
    users: [makeStaffUser(), makeShopAdmin()],
    customers: [makeCustomer()],
    services: [makeService()],
    products: [makeProduct()],
    serviceRecords: [],
    customerOrders: [],
    smsLogs: [],
    ...overrides,
  };
}
