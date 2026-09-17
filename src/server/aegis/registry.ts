/**
 * Unified AEGIS capability registry.
 *
 * ONE source of truth for everything AEGIS may invoke: entity reads/writes
 * call canonical HAPOS services directly; analytics entries delegate to the
 * existing AI tool implementations (no duplicated business logic). Each entry
 * declares its domain, read/write type, risk, explicit input schema, handler,
 * and the user roles allowed to invoke it. Master principals bypass the role
 * matrix (platform authority) but never tenant/shop validation.
 */

import type { AegisPrincipal, ShopContext } from '@/server/aegis/principal';

export type CapabilityType = 'read' | 'action';

export type CapabilityRisk = 'low' | 'medium' | 'high';

export type CapabilityParam = {
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
};

export type CapabilityContext = {
  /** Validated tenant under operation. */
  tenantId: string;
  /** Canonical shop identity (equals tenantId while shops map 1:1). */
  shopId: string;
  /** Acting user id, or `master:<keyId>` for platform authority. */
  userId: string;
  /** HAPOS role for user principals; `master` for platform authority. */
  role: string;
  authority: 'user' | 'master';
  keyId: string | null;
};

export type CapabilityDef = {
  id: string;
  domain: string;
  description: string;
  type: CapabilityType;
  risk: CapabilityRisk;
  params: Record<string, CapabilityParam>;
  /** User roles allowed. Master authority bypasses this list. */
  roles: string[];
  handler: (ctx: CapabilityContext, args: Record<string, unknown>) => Promise<unknown>;
};

export function contextFor(principal: AegisPrincipal, shop: ShopContext): CapabilityContext {
  if (principal.kind === 'master') {
    return {
      tenantId: shop.tenantId,
      shopId: shop.shopId,
      userId: `master:${principal.keyId ?? 'session'}`,
      role: 'master',
      authority: 'master',
      keyId: principal.keyId,
    };
  }
  return {
    tenantId: shop.tenantId,
    shopId: shop.shopId,
    userId: principal.userId,
    role: principal.role,
    authority: 'user',
    keyId: principal.keyId,
  };
}

/** Staff sees the operations floor; financial/admin surfaces stay admin-only. */
const STAFF_READ = new Set([
  'shop.get',
  'products.list',
  'products.get',
  'services.list',
  'services.get',
  'customers.list',
  'customers.search',
  'customers.get',
  'orders.list',
  'orders.get',
  'orders.pending',
  'sales.list',
  'sales.get',
  'bookings.list',
  'bookings.get',
  'inventory.stock',
  'inventory.movements',
  'inventory.lowstock',
  'inventory.valuation',
  'marketplace.list',
  'marketplace.get',
  'sellerqr.pending',
  'sellerqr.order',
  'sellerqr.activity',
  'attendance.records',
  'attendance.daily',
  'staff.performance',
  'reports.dashboard',
]);

const STAFF_ACTION = new Set(['orders.approve', 'orders.reject']);

export function isCapabilityAllowed(role: string, def: CapabilityDef): boolean {
  if (role === 'master' || role === 'super_admin') {
    return true;
  }
  if (role === 'shop_admin') {
    return true;
  }
  if (role === 'staff') {
    return def.type === 'read' ? STAFF_READ.has(def.id) : STAFF_ACTION.has(def.id);
  }
  return false;
}

export function paginate<T>(items: T[], args: Record<string, unknown>): { items: T[]; total: number; limit: number; offset: number } {
  const limit = Math.min(Math.max(Number(args.limit ?? 20) || 20, 1), 100);
  const offset = Math.max(Number(args.offset ?? 0) || 0, 0);
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
}

export function inRange(iso: unknown, from: unknown, to: unknown): boolean {
  if ((from === undefined || from === null || from === '') && (to === undefined || to === null || to === '')) {
    return true;
  }
  if (typeof iso !== 'string' || !iso) {
    return false;
  }
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) {
    return false;
  }
  if (typeof from === 'string' && from) {
    const fromMs = Date.parse(from);
    if (Number.isFinite(fromMs) && time < fromMs) {
      return false;
    }
  }
  if (typeof to === 'string' && to) {
    const toMs = Date.parse(to);
    if (Number.isFinite(toMs) && time > toMs) {
      return false;
    }
  }
  return true;
}

export function str(arg: unknown): string | null {
  return typeof arg === 'string' && arg.trim() ? arg.trim() : null;
}

/** Validate args against the capability schema. Returns INVALID_ARGUMENT detail. */
export function validateCapabilityArgs(def: CapabilityDef, args: Record<string, unknown>): string | null {
  for (const [name, param] of Object.entries(def.params)) {
    const value = args[name];
    if (value === undefined || value === null || value === '') {
      if (param.required) {
        return `Missing required parameter: ${name}.`;
      }
      continue;
    }
    if (param.type === 'string' && typeof value !== 'string') {
      return `Parameter ${name} must be a string.`;
    }
    if (param.type === 'number' && typeof value !== 'number') {
      return `Parameter ${name} must be a number.`;
    }
    if (param.type === 'boolean' && typeof value !== 'boolean') {
      return `Parameter ${name} must be a boolean.`;
    }
  }
  return null;
}
