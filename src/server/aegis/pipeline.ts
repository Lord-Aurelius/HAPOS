/**
 * Authoritative AEGIS execution pipeline. Every programmatic invocation —
 * API-key or session, direct tool route or connection invoke — flows through
 * `invokeCapability`:
 *
 *   authenticate → principal → validated shop → authorize capability
 *   → validate schema → confirmation gate → canonical operation → audit
 *   → structured envelope
 *
 * Results are envelopes, never throws: `{ ok: true, data }` or
 * `{ ok: false, error: { code, message, retryable } }`.
 */

import { AiError, toAiError, type AiErrorBody } from '@/server/aegis/errors';
import { requirePrincipal, shopContextForPrincipal, type AegisPrincipal } from '@/server/aegis/principal';
import {
  contextFor,
  isCapabilityAllowed,
  validateCapabilityArgs,
  type CapabilityContext,
} from '@/server/aegis/registry';
import { findCapability } from '@/server/aegis/capabilities';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { logToolExecution } = require('@/server/ai/ai/aiAuditService');

export type InvokeResult =
  | { ok: true; data: unknown; capability: string; tenantId: string; shopId: string }
  | { ok: false; error: AiErrorBody; capability: string };

export type InvokeInput = {
  principal: AegisPrincipal | null;
  shopId?: unknown;
  capability: unknown;
  args?: Record<string, unknown>;
  /** Explicit confirmation for action capabilities. */
  confirm?: boolean;
  auditActor?: string | null;
};

function sanitizePreviewArgs(args: Record<string, unknown>): Record<string, unknown> {
  const redacted = new Set(['contactPhone', 'customerPhone', 'phone']);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = redacted.has(key) ? '[redacted]' : value;
  }
  return out;
}

async function buildPreview(ctx: CapabilityContext, capabilityId: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const preview: Record<string, unknown> = {
    capability: capabilityId,
    tenantId: ctx.tenantId,
    shopId: ctx.shopId,
    args: sanitizePreviewArgs(args),
  };
  if ((capabilityId === 'orders.approve' || capabilityId === 'orders.reject') && typeof args.orderId === 'string') {
    try {
      const { getCommerceOrder } = await import('@/server/commerce/order-service');
      const role = ctx.role === 'master' || ctx.role === 'super_admin' ? 'super_admin' : ctx.role === 'staff' ? 'staff' : 'shop_admin';
      const order = await getCommerceOrder({ tenantId: ctx.tenantId, userId: ctx.userId, userRole: role }, args.orderId);
      if (order) {
        preview.order = { id: order.id, status: order.status, total: order.total, currencyCode: order.currencyCode };
      }
    } catch {
      /* preview stays structural */
    }
  }
  return preview;
}

export async function invokeCapability(input: InvokeInput): Promise<InvokeResult> {
  const capabilityId = typeof input.capability === 'string' ? input.capability.trim() : '';
  const args = input.args && typeof input.args === 'object' ? input.args : {};
  const startedAt = Date.now();

  try {
    const principal = requirePrincipal(input.principal);
    const shop = await shopContextForPrincipal(principal, input.shopId);
    const def = findCapability(capabilityId);
    if (!def) {
      throw new AiError('NOT_FOUND', `Unknown capability: ${capabilityId || '(empty)'}.`, false);
    }
    const role = principal.kind === 'master' ? 'master' : principal.role;
    if (!isCapabilityAllowed(role, def)) {
      throw new AiError('FORBIDDEN', `Role "${role}" may not invoke ${capabilityId}.`, false);
    }
    const argError = validateCapabilityArgs(def, args);
    if (argError) {
      throw new AiError('INVALID_ARGUMENT', argError, false);
    }

    const ctx = contextFor(principal, shop);
    if (def.type === 'action' && input.confirm !== true && args.confirm !== true) {
      const preview = await buildPreview(ctx, capabilityId, args);
      throw new AiErrorWithPreview('CONFIRMATION_REQUIRED', `Capability ${capabilityId} requires explicit confirmation. Re-invoke with confirm:true and identical args.`, false, preview);
    }

    const data = await def.handler(ctx, args);
    await audit(input, principal, shop, capabilityId, args, true, startedAt, null);
    return { ok: true, data, capability: capabilityId, tenantId: shop.tenantId, shopId: shop.shopId };
  } catch (error) {
    const aiError = toAiError(error);
    if (error instanceof AiErrorWithPreview) {
      try {
        await audit(input, input.principal, null, capabilityId, args, false, startedAt, aiError.message);
      } catch {
        /* audit must not mask the original error */
      }
      return { ok: false, error: { ...aiError.toBody(), preview: error.preview } as AiErrorBody, capability: capabilityId };
    }
    try {
      await audit(input, input.principal, null, capabilityId, args, false, startedAt, aiError.message);
    } catch {
      /* audit must not mask the original error */
    }
    return { ok: false, error: aiError.toBody(), capability: capabilityId };
  }
}

class AiErrorWithPreview extends AiError {
  readonly preview: Record<string, unknown>;
  constructor(code: 'CONFIRMATION_REQUIRED', message: string, retryable: boolean, preview: Record<string, unknown>) {
    super(code, message, retryable);
    this.preview = preview;
  }
}

async function audit(
  input: InvokeInput,
  principal: AegisPrincipal | null,
  shop: { tenantId: string; shopId: string } | null,
  capabilityId: string,
  args: Record<string, unknown>,
  success: boolean,
  startedAt: number,
  error: string | null,
): Promise<void> {
  await logToolExecution({
    userId: principal && principal.kind === 'user' ? principal.userId : null,
    tenantId: shop?.tenantId ?? (principal && principal.kind === 'user' ? principal.tenantId : null),
    role: principal && principal.kind === 'user' ? principal.role : 'master',
    toolId: capabilityId,
    args: { ...sanitizePreviewArgs(args), shopId: shop?.shopId ?? null, keyId: principal?.keyId ?? null },
    success,
    duration: Date.now() - startedAt,
    error,
  });
}
