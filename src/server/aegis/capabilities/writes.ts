/**
 * AEGIS write capabilities — the complete approved set (GATE 14):
 * order approvals/rejections, marketplace advert creation, expense creation.
 * Approvals call the canonical order-service (idempotent by exactly-once
 * sale invariant). Creations call the canonical API mutation ops with
 * mandatory idempotency keys (retries converge). Nothing else is exposed.
 */

import { approveCommerceOrder, rejectCommerceOrder } from '@/server/commerce/order-service';
import { readStore, updateStore } from '@/server/store';
import { createExpenseRecord, createMarketplaceAdvert } from '@/server/services/aegis-mutations';
import { recordAiEvent } from '@/server/aegis/events';
import { AiError } from '@/server/aegis/errors';
import { str, type CapabilityContext, type CapabilityDef } from '@/server/aegis/registry';

const CONFIRM = {
  confirm: { type: 'boolean' as const, description: 'Explicit confirmation. Required true to execute.' },
};

const IDEMPOTENT = {
  idempotencyKey: { type: 'string' as const, description: 'Client idempotency key. Required; retries with the same key converge.', required: true },
};

const APPROVE_ROLES = ['shop_admin', 'staff', 'super_admin'];
const ADMIN_WRITE_ROLES = ['shop_admin', 'super_admin'];

function commerceSessionOf(ctx: CapabilityContext): { tenantId: string; userId: string; userRole: 'shop_admin' | 'staff' | 'super_admin' } {
  const userRole = ctx.role === 'master' || ctx.role === 'super_admin' ? 'super_admin' : ctx.role === 'staff' ? 'staff' : 'shop_admin';
  return { tenantId: ctx.tenantId, userId: ctx.userId, userRole };
}

export const WRITE_CAPABILITIES: CapabilityDef[] = [
  {
    id: 'orders.approve',
    domain: 'Orders',
    description: 'Approve a pending order; finalizes its sale atomically. Idempotent.',
    type: 'action',
    risk: 'medium',
    params: {
      orderId: { type: 'string', description: 'Order id.', required: true },
      ...CONFIRM,
    },
    roles: APPROVE_ROLES,
    handler: async (ctx, args) => {
      const orderId = str(args.orderId);
      if (!orderId) {
        throw new AiError('INVALID_ARGUMENT', 'orderId is required.', false);
      }
      const result = await approveCommerceOrder(commerceSessionOf(ctx), orderId);
      await recordAiEvent({
        tenantId: ctx.tenantId,
        event: 'order.approved',
        entityType: 'order',
        entityId: orderId,
        actorId: ctx.userId,
        summary: `Order approved; sale ${result.sale.id} completed.`,
      });
      return { order: result.order, sale: result.sale, duplicate: result.duplicate };
    },
  },
  {
    id: 'orders.reject',
    domain: 'Orders',
    description: 'Reject a pending order with an optional reason. Idempotent by state.',
    type: 'action',
    risk: 'medium',
    roles: APPROVE_ROLES,
    params: {
      orderId: { type: 'string', description: 'Order id.', required: true },
      reason: { type: 'string', description: 'Optional rejection reason.' },
      ...CONFIRM,
    },
    handler: async (ctx, args) => {
      const orderId = str(args.orderId);
      if (!orderId) {
        throw new AiError('INVALID_ARGUMENT', 'orderId is required.', false);
      }
      const order = await rejectCommerceOrder(commerceSessionOf(ctx), orderId, str(args.reason));
      await recordAiEvent({
        tenantId: ctx.tenantId,
        event: 'order.rejected',
        entityType: 'order',
        entityId: orderId,
        actorId: ctx.userId,
        summary: 'Order rejected.',
      });
      return { order };
    },
  },
  {
    id: 'expenses.create',
    domain: 'Expenses',
    description: 'Record a shop expense. Requires an idempotency key; retries converge.',
    type: 'action',
    risk: 'medium',
    params: {
      category: { type: 'string', description: 'Expense category.', required: true },
      amount: { type: 'number', description: 'Amount in base units.', required: true },
      expenseDate: { type: 'string', description: 'ISO calendar day.', required: true },
      description: { type: 'string', description: 'Optional note.' },
      ...IDEMPOTENT,
      ...CONFIRM,
    },
    roles: ADMIN_WRITE_ROLES,
    handler: async (ctx, args) => {
      const key = str(args.idempotencyKey);
      if (!key) {
        throw new AiError('INVALID_ARGUMENT', 'idempotencyKey is required.', false);
      }
      if (typeof args.amount !== 'number') {
        throw new AiError('INVALID_ARGUMENT', 'amount must be a number.', false);
      }
      const created = await updateStore((store) =>
        createExpenseRecord(store as never, {
          tenantId: ctx.tenantId,
          category: args.category,
          amount: args.amount,
          expenseDate: args.expenseDate,
          description: args.description,
          createdBy: ctx.userId,
          idempotencyKey: key,
        }),
      );
      if (!created.duplicate) {
        await recordAiEvent({
          tenantId: ctx.tenantId,
          event: 'expense.created',
          entityType: 'expense',
          entityId: created.record.id,
          actorId: ctx.userId,
          summary: `Expense ${created.record.category} recorded.`,
        });
      }
      return { expense: created.record, duplicate: created.duplicate };
    },
  },
  {
    id: 'marketplace.ads.create',
    domain: 'Marketplace',
    description: 'Submit a marketplace advert for review (platinum shops). Requires an idempotency key; retries converge.',
    type: 'action',
    risk: 'medium',
    params: {
      title: { type: 'string', description: 'Advert title.', required: true },
      body: { type: 'string', description: 'Advert body.', required: true },
      contactName: { type: 'string', description: 'Optional contact name (defaults to caller).' },
      contactPhone: { type: 'string', description: 'Optional contact phone.' },
      ...IDEMPOTENT,
      ...CONFIRM,
    },
    roles: ['shop_admin'],
    handler: async (ctx, args) => {
      const key = str(args.idempotencyKey);
      if (!key) {
        throw new AiError('INVALID_ARGUMENT', 'idempotencyKey is required.', false);
      }
      const store = await readStore();
      const caller = (store.users ?? []).find((item) => item.id === ctx.userId) ?? null;
      const created = await updateStore((inner) =>
        createMarketplaceAdvert(inner as never, {
          tenantId: ctx.tenantId,
          title: args.title,
          body: args.body,
          contactName: args.contactName,
          contactPhone: args.contactPhone,
          createdBy: ctx.userId,
          creatorName: caller?.fullName ?? null,
          creatorPhone: caller?.phone ?? null,
          idempotencyKey: key,
        }),
      );
      if (!created.duplicate) {
        await recordAiEvent({
          tenantId: ctx.tenantId,
          event: 'marketplace.advert.created',
          entityType: 'marketplace_advert',
          entityId: created.record.id,
          actorId: ctx.userId,
          summary: `Marketplace advert submitted for review.`,
        });
      }
      return { advert: created.record, duplicate: created.duplicate };
    },
  },
];
