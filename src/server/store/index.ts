import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { cache } from 'react';

import type {
  AppSession,
  Customer,
  CustomerAppSession,
  Product,
  ProductUsage,
  Service,
  ServiceRecord,
  Subscription,
  SubscriptionPackage,
  Tenant,
  User,
} from '@/lib/types';
import { formatPlanCode, getDefaultSubscriptionPackageBlueprints, isPlatinumPlan, normalizePlanCode } from '@/lib/plans';
import { normalizeStoreAssetReferences } from '@/server/assets';
import { getDatabaseConfigHint } from '@/server/db/config';
import { getPool } from '@/server/db/client';
import { getRuntimeBackend } from '@/server/runtime';
import { createSeedStore } from '@/server/store/seed';
import { verifyPassword } from '@/server/store/passwords';
import { isActiveServiceRecord } from '@/server/store/service-records';
import type {
  StoreCustomer,
  StoreCustomerSession,
  StoreExpense,
  StoreLoyaltyProgram,
  StoreProduct,
  StoreService,
  StoreServiceRecord,
  StoreSession,
  StoreState,
  StoreSubscription,
  StoreSubscriptionPackage,
  StoreTenant,
  StoreUser,
} from '@/server/store/types';

const storePath = path.join(process.cwd(), 'data', 'store.json');
let writeChain = Promise.resolve();
const runtimeStoreId = 1;
const runtimeStoreTableSql = `
create schema if not exists app;

create table if not exists app.runtime_state (
  id integer primary key check (id = 1),
  state jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`;

function createDefaultLoyaltyProgram(): StoreLoyaltyProgram {
  return {
    isEnabled: false,
    spendThreshold: 10000,
    rewardType: 'free_service',
    rewardValue: 0,
    rewardLabel: 'Complimentary service',
    notes: null,
  };
}

function normalizeLoyaltyProgram(program?: Partial<StoreLoyaltyProgram> | null): StoreLoyaltyProgram {
  const defaults = createDefaultLoyaltyProgram();

  return {
    ...defaults,
    ...(program ?? {}),
  };
}

function createDefaultPackageCatalog(timestamp: string): StoreSubscriptionPackage[] {
  return getDefaultSubscriptionPackageBlueprints().map((item) => ({
    id: `package-${item.code}`,
    ...item,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}

function createFallbackPackage(planCode: string, timestamp: string): StoreSubscriptionPackage {
  const normalized = normalizePlanCode(planCode);
  const includesMarketplace = isPlatinumPlan(normalized);

  return {
    id: `package-${normalized || randomUUID()}`,
    code: normalized,
    name: formatPlanCode(normalized),
    description: `Imported package for ${formatPlanCode(normalized)} tenants.`,
    features: includesMarketplace
      ? ['Marketplace access enabled for shops and customers']
      : ['Core HAPOS operations package'],
    amount: 0,
    currencyCode: 'KES',
    billingPeriod: 'monthly',
    includesMarketplace,
    includesCustomerMarketplace: includesMarketplace,
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function normalizePhoneValue(value: string) {
  return value.replace(/\D/g, '');
}

function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase();
}

async function ensureStoreFile() {
  await mkdir(path.dirname(storePath), { recursive: true });

  try {
    await readFile(storePath, 'utf8');
  } catch {
    await writeFile(storePath, JSON.stringify(createSeedStore(), null, 2), 'utf8');
  }
}

async function readBootstrapStoreSource() {
  try {
    const raw = await readFile(storePath, 'utf8');
    return JSON.parse(raw) as StoreState;
  } catch {
    return createSeedStore();
  }
}

function parseRuntimeState(value: unknown) {
  if (typeof value === 'string') {
    return JSON.parse(value) as StoreState;
  }

  return value as StoreState;
}

function migrateStoreState(parsed: StoreState) {
  let changed = false;
  const migrationTimestamp = new Date().toISOString();

  if (!Array.isArray(parsed.customerSessions)) {
    parsed.customerSessions = [];
    changed = true;
  }

  if (!Array.isArray(parsed.marketplaceAds)) {
    parsed.marketplaceAds = [];
    changed = true;
  }

  if (!Array.isArray(parsed.customerOrders)) {
    parsed.customerOrders = [];
    changed = true;
  }

  if (!Array.isArray(parsed.subscriptionPackages)) {
    parsed.subscriptionPackages = createDefaultPackageCatalog(migrationTimestamp);
    changed = true;
  }

  for (const user of parsed.users) {
    const legacyUser = user as StoreUser & { passwordText?: string | null };

    if ('passwordText' in legacyUser) {
      delete legacyUser.passwordText;
      changed = true;
    }

    if (!('passwordUpdatedAt' in user)) {
      user.passwordUpdatedAt = user.updatedAt ?? user.createdAt;
      changed = true;
    }
  }

  for (const tenant of parsed.tenants) {
    if (!('logoUrl' in tenant)) {
      tenant.logoUrl = null;
      changed = true;
    }
    if (!('motto' in tenant)) {
      tenant.motto = null;
      changed = true;
    }
    if (!('address' in tenant)) {
      tenant.address = null;
      changed = true;
    }
    if (!('storeNumber' in tenant)) {
      tenant.storeNumber = null;
      changed = true;
    }
    if (!('loyaltyProgram' in tenant) || !tenant.loyaltyProgram) {
      tenant.loyaltyProgram = createDefaultLoyaltyProgram();
      changed = true;
    } else {
      const normalizedProgram = normalizeLoyaltyProgram(tenant.loyaltyProgram);
      if (JSON.stringify(normalizedProgram) !== JSON.stringify(tenant.loyaltyProgram)) {
        tenant.loyaltyProgram = normalizedProgram;
        changed = true;
      }
    }
  }

  for (const service of parsed.services) {
    if (!('imageUrl' in service)) {
      service.imageUrl = null;
      changed = true;
    }
  }

  for (const subscription of parsed.subscriptions) {
    const normalizedPlan = normalizePlanCode(subscription.planCode);
    if (subscription.planCode !== normalizedPlan) {
      subscription.planCode = normalizedPlan;
      changed = true;
    }
  }

  const defaultPackageCatalog = createDefaultPackageCatalog(migrationTimestamp);
  for (const defaultPackage of defaultPackageCatalog) {
    const existing = parsed.subscriptionPackages.find((item) => item.code === defaultPackage.code);
    if (!existing) {
      parsed.subscriptionPackages.push(defaultPackage);
      changed = true;
      continue;
    }

    const legacyPackage = existing as Partial<StoreSubscriptionPackage> & StoreSubscriptionPackage;

    if (!Array.isArray(legacyPackage.features)) {
      legacyPackage.features = defaultPackage.features;
      changed = true;
    }
    if (legacyPackage.description === undefined) {
      legacyPackage.description = defaultPackage.description;
      changed = true;
    }
    if (legacyPackage.currencyCode === undefined) {
      legacyPackage.currencyCode = defaultPackage.currencyCode;
      changed = true;
    }
    if (legacyPackage.billingPeriod === undefined) {
      legacyPackage.billingPeriod = defaultPackage.billingPeriod;
      changed = true;
    }
    if (legacyPackage.includesMarketplace === undefined) {
      legacyPackage.includesMarketplace = defaultPackage.includesMarketplace;
      changed = true;
    }
    if (legacyPackage.includesCustomerMarketplace === undefined) {
      legacyPackage.includesCustomerMarketplace = defaultPackage.includesCustomerMarketplace;
      changed = true;
    }
    if (legacyPackage.isActive === undefined) {
      legacyPackage.isActive = true;
      changed = true;
    }
    if (legacyPackage.createdAt === undefined) {
      legacyPackage.createdAt = migrationTimestamp;
      changed = true;
    }
    if (legacyPackage.updatedAt === undefined) {
      legacyPackage.updatedAt = migrationTimestamp;
      changed = true;
    }
  }

  for (const subscription of parsed.subscriptions) {
    const packageById = subscription.packageId
      ? parsed.subscriptionPackages.find((item) => item.id === subscription.packageId)
      : null;
    const packageByCode = parsed.subscriptionPackages.find((item) => item.code === subscription.planCode);
    const resolvedPackage = packageById ?? packageByCode;

    if (!resolvedPackage) {
      const fallbackPackage = createFallbackPackage(subscription.planCode, migrationTimestamp);
      parsed.subscriptionPackages.push(fallbackPackage);
      subscription.packageId = fallbackPackage.id;
      subscription.planCode = fallbackPackage.code;
      changed = true;
      continue;
    }

    if (subscription.packageId !== resolvedPackage.id) {
      subscription.packageId = resolvedPackage.id;
      changed = true;
    }

    if (subscription.planCode !== resolvedPackage.code) {
      subscription.planCode = resolvedPackage.code;
      changed = true;
    }
  }

  for (const record of parsed.serviceRecords) {
    if (!('correctedAt' in record)) {
      record.correctedAt = null;
      changed = true;
    }
    if (!('correctedBy' in record)) {
      record.correctedBy = null;
      changed = true;
    }
    if (!('voidedAt' in record)) {
      record.voidedAt = null;
      changed = true;
    }
    if (!('voidedBy' in record)) {
      record.voidedBy = null;
      changed = true;
    }
    if (!('voidReason' in record)) {
      record.voidReason = null;
      changed = true;
    }
  }

  for (const ad of parsed.marketplaceAds) {
    if (!('imageUrl' in ad)) {
      ad.imageUrl = null;
      changed = true;
    }
    if (!('approvalNotes' in ad)) {
      ad.approvalNotes = null;
      changed = true;
    }
    if (!('approvedBy' in ad)) {
      ad.approvedBy = null;
      changed = true;
    }
    if (!('approvedAt' in ad)) {
      ad.approvedAt = null;
      changed = true;
    }
  }

  for (const order of parsed.customerOrders) {
    const legacyOrder = order as {
      serviceId: string;
      tenantId: string;
      statusUpdatedAt?: string | null;
      quotedPrice?: number;
      approvedAt?: string | null;
      approvedBy?: string | null;
      approvedRecordId?: string | null;
    };

    if (!('quotedPrice' in legacyOrder)) {
      legacyOrder.quotedPrice =
        parsed.services.find((service) => service.id === legacyOrder.serviceId && service.tenantId === legacyOrder.tenantId)?.price ?? 0;
      changed = true;
    }
    if (!('statusUpdatedAt' in legacyOrder)) {
      legacyOrder.statusUpdatedAt = null;
      changed = true;
    }
    if (!('approvedAt' in legacyOrder)) {
      legacyOrder.approvedAt = null;
      changed = true;
    }
    if (!('approvedBy' in legacyOrder)) {
      legacyOrder.approvedBy = null;
      changed = true;
    }
    if (!('approvedRecordId' in legacyOrder)) {
      legacyOrder.approvedRecordId = null;
      changed = true;
    }
  }

  return { store: parsed, changed };
}

async function readStoreFromFile(): Promise<StoreState> {
  await ensureStoreFile();
  const raw = await readFile(storePath, 'utf8');
  const parsed = JSON.parse(raw) as StoreState;
  const { store, changed } = migrateStoreState(parsed);
  const assetsChanged = await normalizeStoreAssetReferences(store);

  if (changed || assetsChanged) {
    await writeStoreFile(store);
  }

  return store;
}

async function writeStoreFile(store: StoreState): Promise<void> {
  writeChain = writeChain.then(() => writeFile(storePath, JSON.stringify(store, null, 2), 'utf8'));
  await writeChain;
}

async function ensureRuntimeStoreTable(client: PoolClient) {
  await client.query(runtimeStoreTableSql);
}

async function loadRuntimeStoreForUpdate(client: PoolClient) {
  await ensureRuntimeStoreTable(client);

  let result = await client.query('select state from app.runtime_state where id = $1 for update', [runtimeStoreId]);

  if (result.rowCount === 0) {
    const bootstrapStore = migrateStoreState(await readBootstrapStoreSource()).store;
    await client.query(
      'insert into app.runtime_state (id, state) values ($1, $2::jsonb) on conflict (id) do nothing',
      [runtimeStoreId, JSON.stringify(bootstrapStore)],
    );
    result = await client.query('select state from app.runtime_state where id = $1 for update', [runtimeStoreId]);
  }

  if (result.rowCount === 0) {
    throw new Error('Could not initialize the Postgres-backed runtime store.');
  }

  const { store, changed } = migrateStoreState(parseRuntimeState(result.rows[0].state));
  const assetsChanged = await normalizeStoreAssetReferences(store, client);

  return { store, changed: changed || assetsChanged };
}

async function readStoreFromPostgres(): Promise<StoreState> {
  const pool = getPool();
  if (!pool) {
    throw new Error(`A Postgres connection string (${getDatabaseConfigHint()}) is required when HAPOS_RUNTIME_MODE=postgres.`);
  }

  const client = await pool.connect();

  try {
    await ensureRuntimeStoreTable(client);
    let result = await client.query('select state from app.runtime_state where id = $1', [runtimeStoreId]);

    if (result.rowCount === 0) {
      const bootstrapStore = migrateStoreState(await readBootstrapStoreSource()).store;
      await client.query(
        'insert into app.runtime_state (id, state) values ($1, $2::jsonb) on conflict (id) do nothing',
        [runtimeStoreId, JSON.stringify(bootstrapStore)],
      );
      result = await client.query('select state from app.runtime_state where id = $1', [runtimeStoreId]);
    }

    if (result.rowCount === 0) {
      throw new Error('Could not read the Postgres-backed runtime store.');
    }

    const { store, changed } = migrateStoreState(parseRuntimeState(result.rows[0].state));
    const assetsChanged = await normalizeStoreAssetReferences(store, client);

    if (changed || assetsChanged) {
      await client.query(
        'update app.runtime_state set state = $2::jsonb, version = version + 1, updated_at = now() where id = $1',
        [runtimeStoreId, JSON.stringify(store)],
      );
    }

    return store;
  } finally {
    client.release();
  }
}

async function writeStoreToPostgres(store: StoreState): Promise<void> {
  const pool = getPool();
  if (!pool) {
    throw new Error(`A Postgres connection string (${getDatabaseConfigHint()}) is required when HAPOS_RUNTIME_MODE=postgres.`);
  }

  const client = await pool.connect();

  try {
    await ensureRuntimeStoreTable(client);
    await client.query(
      `
        insert into app.runtime_state (id, state)
        values ($1, $2::jsonb)
        on conflict (id)
        do update set state = excluded.state, version = app.runtime_state.version + 1, updated_at = now()
      `,
      [runtimeStoreId, JSON.stringify(store)],
    );
  } finally {
    client.release();
  }
}

async function loadStoreDirect(): Promise<StoreState> {
  if (getRuntimeBackend() === 'postgres') {
    return readStoreFromPostgres();
  }

  return readStoreFromFile();
}

const readStoreCached = cache(loadStoreDirect);

export async function readStore(): Promise<StoreState> {
  return readStoreCached();
}

export async function writeStore(store: StoreState): Promise<void> {
  if (getRuntimeBackend() === 'postgres') {
    await writeStoreToPostgres(store);
    return;
  }

  await writeStoreFile(store);
}

export async function updateStore<T>(mutator: (store: StoreState) => T | Promise<T>): Promise<T> {
  if (getRuntimeBackend() === 'postgres') {
    const pool = getPool();
    if (!pool) {
      throw new Error(`A Postgres connection string (${getDatabaseConfigHint()}) is required when HAPOS_RUNTIME_MODE=postgres.`);
    }

    const client = await pool.connect();

    try {
      await client.query('begin');
      const { store } = await loadRuntimeStoreForUpdate(client);
      const result = await mutator(store);
      await client.query(
        'update app.runtime_state set state = $2::jsonb, version = version + 1, updated_at = now() where id = $1',
        [runtimeStoreId, JSON.stringify(store)],
      );
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  const store = await loadStoreDirect();
  const result = await mutator(store);
  await writeStore(store);
  return result;
}

function tenantFromStore(tenant: StoreTenant): Tenant {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    logoUrl: tenant.logoUrl,
    motto: tenant.motto,
    address: tenant.address,
    storeNumber: tenant.storeNumber,
    timezone: tenant.timezone,
    countryCode: tenant.countryCode,
    currencyCode: tenant.currencyCode,
    status: tenant.status,
    suspensionReason: tenant.suspensionReason,
    ownerName: tenant.ownerName,
    loyaltyProgram: tenant.loyaltyProgram ? { ...tenant.loyaltyProgram } : null,
  };
}

function userFromStore(user: StoreUser): User {
  return {
    id: user.id,
    tenantId: user.tenantId,
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    commissionType: user.commissionType,
    commissionValue: user.commissionValue,
    commissionNotes: user.commissionNotes,
  };
}

function packageFromStore(item: StoreSubscriptionPackage): SubscriptionPackage {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    description: item.description ?? null,
    features: item.features ?? [],
    amount: item.amount,
    currencyCode: item.currencyCode,
    billingPeriod: item.billingPeriod,
    includesMarketplace: item.includesMarketplace,
    includesCustomerMarketplace: item.includesCustomerMarketplace,
    isActive: item.isActive,
  };
}

function subscriptionFromStore(item: StoreSubscription, subscriptionPackage?: StoreSubscriptionPackage | null): Subscription {
  const resolvedPackage = subscriptionPackage ?? null;

  return {
    id: item.id,
    tenantId: item.tenantId,
    packageId: item.packageId ?? resolvedPackage?.id ?? null,
    planCode: resolvedPackage?.code ?? normalizePlanCode(item.planCode),
    packageName: resolvedPackage?.name ?? formatPlanCode(item.planCode),
    packageDescription: resolvedPackage?.description ?? null,
    packageFeatures: resolvedPackage?.features ?? [],
    billingPeriod: resolvedPackage?.billingPeriod ?? 'monthly',
    includesMarketplace: resolvedPackage?.includesMarketplace ?? isPlatinumPlan(item.planCode),
    includesCustomerMarketplace:
      resolvedPackage?.includesCustomerMarketplace ??
      resolvedPackage?.includesMarketplace ??
      isPlatinumPlan(item.planCode),
    status: item.status,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    graceEndsAt: item.graceEndsAt,
    amount: item.amount,
    currencyCode: item.currencyCode,
    autoRenew: item.autoRenew,
    paymentTerms: item.paymentTerms,
  };
}

function enrichCustomer(customer: StoreCustomer, records: StoreServiceRecord[]): Customer {
  const visits = records.filter((record) => record.customerId === customer.id);

  return {
    id: customer.id,
    tenantId: customer.tenantId,
    name: customer.name,
    phone: customer.phone,
    phoneE164: customer.phoneE164,
    notes: customer.notes,
    marketingOptIn: customer.marketingOptIn,
    archivedAt: customer.archivedAt,
    totalVisits: visits.length,
    lifetimeValue: visits.reduce((sum, record) => sum + record.price, 0),
    lastVisitAt: [...visits].sort((a, b) => b.performedAt.localeCompare(a.performedAt))[0]?.performedAt ?? null,
  };
}

function productUsageFromStore(
  usage: ProductUsage | { productId: string; quantity: number; unitCost: number },
  products: StoreProduct[],
): ProductUsage {
  const product = products.find((item) => item.id === usage.productId);

  return {
    productId: usage.productId,
    productName: product?.name ?? 'Unknown product',
    quantity: usage.quantity,
    unitCost: usage.unitCost,
    totalCost: usage.quantity * usage.unitCost,
  };
}

function recordFromStore(
  record: StoreServiceRecord,
  users: StoreUser[],
  customers: StoreCustomer[],
  products: StoreProduct[],
): ServiceRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    customerId: record.customerId,
    staffId: record.staffId,
    serviceId: record.serviceId,
    price: record.price,
    description: record.description,
    commission: record.commissionAmount,
    performedAt: record.performedAt,
    customerName: customers.find((item) => item.id === record.customerId)?.name,
    serviceName: record.serviceName,
    staffName: users.find((item) => item.id === record.staffId)?.fullName,
    isCustomService: record.isCustomService,
    productUsages: record.productUsages.map((usage) => productUsageFromStore(usage, products)),
    correctedAt: record.correctedAt,
    correctedBy: record.correctedBy,
    correctedByName: record.correctedBy ? users.find((item) => item.id === record.correctedBy)?.fullName : null,
    voidedAt: record.voidedAt,
    voidedBy: record.voidedBy,
    voidedByName: record.voidedBy ? users.find((item) => item.id === record.voidedBy)?.fullName : null,
    voidReason: record.voidReason,
  };
}

function serviceFromStore(service: StoreService): Service {
  return {
    id: service.id,
    tenantId: service.tenantId,
    name: service.name,
    price: service.price,
    description: service.description,
    imageUrl: service.imageUrl,
    commissionType: service.commissionType,
    commissionValue: service.commissionValue,
    durationMinutes: service.durationMinutes,
    isActive: service.isActive,
  };
}

function productFromStore(product: StoreProduct): Product {
  return {
    id: product.id,
    tenantId: product.tenantId,
    name: product.name,
    unitCost: product.unitCost,
    description: product.description,
    isActive: product.isActive,
  };
}

export async function listTenantsStore() {
  const store = await readStore();
  return store.tenants.map(tenantFromStore);
}

export async function getTenantBySlug(slug: string) {
  const store = await readStore();
  const lookup = normalizeLookupValue(slug);
  return store.tenants.find((tenant) => normalizeLookupValue(tenant.slug) === lookup) ?? null;
}

export async function getTenantById(id: string) {
  const store = await readStore();
  return store.tenants.find((tenant) => tenant.id === id) ?? null;
}

export async function listUsersByTenant(tenantId: string | null) {
  const store = await readStore();
  return store.users.filter((user) => user.tenantId === tenantId).map(userFromStore);
}

export async function listServicesByTenant(tenantId: string) {
  const store = await readStore();
  return store.services.filter((service) => service.tenantId === tenantId).map(serviceFromStore);
}

export async function listProductsByTenant(tenantId: string) {
  const store = await readStore();
  return store.products.filter((product) => product.tenantId === tenantId).map(productFromStore);
}

export async function listSubscriptionPackagesStore() {
  const store = await readStore();
  return store.subscriptionPackages
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(packageFromStore);
}

export async function listCustomersByTenant(tenantId: string) {
  const store = await readStore();
  const records = store.serviceRecords
    .filter((record) => record.tenantId === tenantId)
    .filter(isActiveServiceRecord);

  return store.customers
    .filter((customer) => customer.tenantId === tenantId && !customer.archivedAt)
    .map((customer) => enrichCustomer(customer, records));
}

export async function listAllCustomersByTenant(tenantId: string) {
  const store = await readStore();
  const records = store.serviceRecords
    .filter((record) => record.tenantId === tenantId)
    .filter(isActiveServiceRecord);

  return store.customers
    .filter((customer) => customer.tenantId === tenantId)
    .map((customer) => enrichCustomer(customer, records));
}

export async function listRecordsByTenant(tenantId: string) {
  const store = await readStore();
  return store.serviceRecords
    .filter((record) => record.tenantId === tenantId)
    .filter(isActiveServiceRecord)
    .sort((a, b) => b.performedAt.localeCompare(a.performedAt))
    .map((record) => recordFromStore(record, store.users, store.customers, store.products));
}

export async function listExpensesByTenant(tenantId: string) {
  const store = await readStore();
  return store.expenses.filter((expense) => expense.tenantId === tenantId);
}

export async function listSubscriptionsStore() {
  const store = await readStore();
  return store.subscriptions.map((subscription) =>
    subscriptionFromStore(
      subscription,
      store.subscriptionPackages.find((item) => item.id === subscription.packageId || item.code === subscription.planCode) ?? null,
    ),
  );
}

export async function getSubscriptionForTenant(tenantId: string) {
  const store = await readStore();
  const item = store.subscriptions.find((subscription) => subscription.tenantId === tenantId) ?? null;
  return item
    ? subscriptionFromStore(
        item,
        store.subscriptionPackages.find((packageItem) => packageItem.id === item.packageId || packageItem.code === item.planCode) ?? null,
      )
    : null;
}

export async function listSmsLogsByTenant(tenantId: string) {
  const store = await readStore();
  return store.smsLogs.filter((item) => item.tenantId === tenantId);
}

export async function listCommissionPayoutsByTenant(tenantId: string) {
  const store = await readStore();
  return store.commissionPayouts.filter((item) => item.tenantId === tenantId);
}

export async function authenticateUser(input: { businessSlug: string; username: string; password: string }) {
  const store = await readStore();
  const businessSlugLookup = normalizeLookupValue(input.businessSlug);
  const usernameLookup = normalizeLookupValue(input.username);

  if (businessSlugLookup === 'platform') {
    const superAdmin = store.users.find(
      (user) => user.role === 'super_admin' && normalizeLookupValue(user.username) === usernameLookup,
    );
    if (!superAdmin || !verifyPassword(input.password, superAdmin.password) || !superAdmin.isActive) {
      return null;
    }

    return {
      user: superAdmin,
      tenant: null,
      subscription: null,
    };
  }

  const tenant = store.tenants.find((item) => normalizeLookupValue(item.slug) === businessSlugLookup);
  if (!tenant) {
    return null;
  }

  const subscription = store.subscriptions.find((item) => item.tenantId === tenant.id);
  const user = store.users.find(
    (item) => item.tenantId === tenant.id && normalizeLookupValue(item.username) === usernameLookup && item.isActive,
  );

  if (!user || !verifyPassword(input.password, user.password)) {
    return null;
  }

  return { user, tenant, subscription: subscription ?? null };
}

export async function authenticateCustomer(input: { businessSlug: string; phone: string }) {
  const store = await readStore();
  const tenant = store.tenants.find((item) => normalizeLookupValue(item.slug) === normalizeLookupValue(input.businessSlug));

  if (!tenant) {
    return null;
  }

  const normalizedInput = normalizePhoneValue(input.phone);
  const customer =
    store.customers.find(
      (item) =>
        item.tenantId === tenant.id &&
        !item.archivedAt &&
        (normalizePhoneValue(item.phone) === normalizedInput ||
          normalizePhoneValue(item.phoneE164) === normalizedInput),
    ) ?? null;

  if (!customer) {
    return null;
  }

  const subscription = store.subscriptions.find((item) => item.tenantId === tenant.id) ?? null;
  return {
    customer,
    tenant,
    subscription,
  };
}

export async function createSession(input: { userId: string; tenantId: string | null; role: AppSession['user']['role'] }) {
  return updateStore((store) => {
    const session: StoreSession = {
      id: randomUUID(),
      userId: input.userId,
      tenantId: input.tenantId,
      role: input.role,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
    };

    store.sessions = store.sessions.filter((item) => item.userId !== input.userId);
    store.sessions.push(session);
    return session;
  });
}

export async function createCustomerSession(input: { customerId: string; tenantId: string }) {
  return updateStore((store) => {
    const session: StoreCustomerSession = {
      id: randomUUID(),
      customerId: input.customerId,
      tenantId: input.tenantId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
    };

    store.customerSessions = store.customerSessions.filter((item) => item.customerId !== input.customerId);
    store.customerSessions.push(session);
    return session;
  });
}

export async function getSession(sessionId: string): Promise<AppSession | null> {
  const store = await readStore();
  const session = store.sessions.find((item) => item.id === sessionId);

  if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
    return null;
  }

  const user = store.users.find((item) => item.id === session.userId);
  if (!user || !user.isActive) {
    return null;
  }

  const tenant = session.tenantId ? store.tenants.find((item) => item.id === session.tenantId) ?? null : null;
  const subscription = session.tenantId
    ? store.subscriptions.find((item) => item.tenantId === session.tenantId) ?? null
    : null;
  const subscriptionPackage = subscription
    ? store.subscriptionPackages.find((item) => item.id === subscription.packageId || item.code === subscription.planCode) ?? null
    : null;

  return {
    sessionId: session.id,
    user: userFromStore(user),
    tenant: tenant ? tenantFromStore(tenant) : null,
    subscription: subscription ? subscriptionFromStore(subscription, subscriptionPackage) : null,
  };
}

export async function getCustomerSession(sessionId: string): Promise<CustomerAppSession | null> {
  const store = await readStore();
  const session = store.customerSessions.find((item) => item.id === sessionId);

  if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
    return null;
  }

  const customer = store.customers.find((item) => item.id === session.customerId && !item.archivedAt);
  const tenant = store.tenants.find((item) => item.id === session.tenantId);

  if (!customer || !tenant) {
    return null;
  }

  const subscription = store.subscriptions.find((item) => item.tenantId === session.tenantId) ?? null;
  const subscriptionPackage = subscription
    ? store.subscriptionPackages.find((item) => item.id === subscription.packageId || item.code === subscription.planCode) ?? null
    : null;
  const records = store.serviceRecords
    .filter((record) => record.tenantId === session.tenantId)
    .filter(isActiveServiceRecord);

  return {
    sessionId: session.id,
    customer: enrichCustomer(customer, records),
    tenant: tenantFromStore(tenant),
    subscription: subscription ? subscriptionFromStore(subscription, subscriptionPackage) : null,
  };
}

export async function deleteSession(sessionId: string) {
  await updateStore((store) => {
    store.sessions = store.sessions.filter((item) => item.id !== sessionId);
  });
}

export async function deleteCustomerSession(sessionId: string) {
  await updateStore((store) => {
    store.customerSessions = store.customerSessions.filter((item) => item.id !== sessionId);
  });
}
