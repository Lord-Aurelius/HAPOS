/**
 * Canonical API write operations (AEGIS/programmatic surface).
 *
 * Expense and marketplace-advert creation with the same validation rules the
 * UI flows enforce (canonical validators from sale-validation, platinum rule
 * from lib/plans) plus mandatory idempotency keys so retried API writes
 * converge instead of duplicating. UI actions keep their inline flows; this
 * module is the canonical operation for non-UI callers.
 *
 * Operates on minimal structural store types: runs under `node --test`.
 */

import { randomUUID } from 'node:crypto';

import { isPlatinumPlan } from '../../lib/plans.ts';
import {
  parseExpenseDateInput,
  parseMoneyInput,
  requireDisplayName,
} from '../commerce/sale-validation.ts';

export type MutationContext = {
  now?: string;
  generateId?: () => string;
};

function contextNow(ctx: MutationContext): string {
  return ctx.now ?? new Date().toISOString();
}

function contextId(ctx: MutationContext): string {
  return (ctx.generateId ?? randomUUID)();
}

export type ExpenseStore = {
  expenses: {
    id: string;
    tenantId: string;
    category: string;
    description?: string;
    amount: number;
    expenseDate: string;
    createdBy: string;
    createdAt: string;
    idempotencyKey?: string | null;
  }[];
};

export type CreatedExpense = {
  record: ExpenseStore['expenses'][number];
  duplicate: boolean;
};

/**
 * Create an expense. `idempotencyKey` is REQUIRED at the API boundary (the
 * pipeline enforces it); repeats with the same tenant + key return the
 * original row.
 */
export function createExpenseRecord(
  store: ExpenseStore,
  input: {
    tenantId: string;
    category: unknown;
    amount: unknown;
    expenseDate: unknown;
    description?: unknown;
    createdBy: string;
    idempotencyKey?: string | null;
  },
  ctx: MutationContext = {},
): CreatedExpense {
  const category = requireDisplayName(input.category, 'category');
  const amount = parseMoneyInput(input.amount, 'amount', 'invalid-amount');
  const expenseDate = parseExpenseDateInput(input.expenseDate);
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 500) : '';
  const key = typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim() ? input.idempotencyKey.trim() : null;

  const now = contextNow(ctx);
  if (key) {
    const existing = (store.expenses ?? []).find((item) => item.tenantId === input.tenantId && item.idempotencyKey === key) ?? null;
    if (existing) {
      return { record: existing, duplicate: true };
    }
  }

  const record: ExpenseStore['expenses'][number] = {
    id: contextId(ctx),
    tenantId: input.tenantId,
    category,
    description,
    amount,
    expenseDate,
    createdBy: input.createdBy,
    createdAt: now,
    idempotencyKey: key,
  };
  (store.expenses ??= []).push(record);
  return { record, duplicate: false };
}

export type AdvertStore = {
  subscriptions: { tenantId: string; packageId?: string | null; planCode: string }[];
  subscriptionPackages: { id: string; code: string; includesMarketplace?: boolean | null }[];
  marketplaceAds: {
    id: string;
    tenantId: string;
    title: string;
    body: string;
    contactName: string;
    contactPhone: string;
    imageUrl?: string | null;
    status: string;
    approvalNotes?: string | null;
    createdBy: string;
    approvedBy?: string | null;
    approvedAt?: string | null;
    createdAt: string;
    updatedAt: string;
    idempotencyKey?: string | null;
  }[];
};

export type CreatedAdvert = {
  record: AdvertStore['marketplaceAds'][number];
  duplicate: boolean;
};

export class MutationError extends Error {
  readonly code: 'not-permitted' | 'invalid-argument';
  constructor(code: 'not-permitted' | 'invalid-argument', message: string) {
    super(message);
    this.name = 'MutationError';
    this.code = code;
  }
}

function isPlatinumTenant(store: AdvertStore, tenantId: string): boolean {
  const subscription = (store.subscriptions ?? []).find((item) => item.tenantId === tenantId) ?? null;
  const pack = subscription
    ? ((store.subscriptionPackages ?? []).find((item) => item.id === subscription.packageId || item.code === subscription.planCode) ?? null)
    : null;
  return Boolean(pack?.includesMarketplace) || isPlatinumPlan(subscription?.planCode);
}

/**
 * Create a marketplace advert (always `pending` review). Same platinum gate
 * as the UI flow; API callers cannot attach images (imageUrl stays null).
 */
export function createMarketplaceAdvert(
  store: AdvertStore,
  input: {
    tenantId: string;
    title: unknown;
    body: unknown;
    contactName?: unknown;
    contactPhone?: unknown;
    createdBy: string;
    creatorName?: string | null;
    creatorPhone?: string | null;
    idempotencyKey?: string | null;
  },
  ctx: MutationContext = {},
): CreatedAdvert {
  if (!isPlatinumTenant(store, input.tenantId)) {
    throw new MutationError('not-permitted', 'Marketplace is only available to platinum tenants.');
  }
  const title = requireDisplayName(input.title, 'title').slice(0, 120);
  const body = requireDisplayName(input.body, 'body').slice(0, 2000);
  const contactName =
    (typeof input.contactName === 'string' && input.contactName.trim()
      ? input.contactName.trim()
      : (input.creatorName ?? '').trim() || 'Shop admin').slice(0, 120);
  const contactPhone = (
    typeof input.contactPhone === 'string' && input.contactPhone.trim()
      ? input.contactPhone.trim()
      : (input.creatorPhone ?? '').trim()
  ).slice(0, 32);
  const key = typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim() ? input.idempotencyKey.trim() : null;

  const now = contextNow(ctx);
  if (key) {
    const existing = (store.marketplaceAds ?? []).find((item) => item.tenantId === input.tenantId && item.idempotencyKey === key) ?? null;
    if (existing) {
      return { record: existing, duplicate: true };
    }
  }

  const record: AdvertStore['marketplaceAds'][number] = {
    id: contextId(ctx),
    tenantId: input.tenantId,
    title,
    body,
    contactName,
    contactPhone,
    imageUrl: null,
    status: 'pending',
    approvalNotes: null,
    createdBy: input.createdBy,
    approvedBy: null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
    idempotencyKey: key,
  };
  (store.marketplaceAds ??= []).push(record);
  return { record, duplicate: false };
}
