import { apiBadRequest, apiCreated, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import {
  adjustProductStock,
  ensureCatalogProjection,
  postInventoryMovement,
  postOpeningBalance,
} from '@/server/commerce/inventory-store';
import { InventoryError, type InventoryMovementType } from '@/server/commerce/inventory';
import { SaleValidationError, parseProductQuantityInput } from '@/server/commerce/sale-validation';
import { listInventoryMovements } from '@/server/services/app-data';
import { updateStore } from '@/server/store';

export async function GET(request: Request) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiOk({ items: [] });
  }
  const { searchParams } = new URL(request.url);
  const items = await listInventoryMovements(session.tenant.id, searchParams.get('productId') ?? undefined);
  return apiOk({ items });
}

const STOCK_IN_TYPES: InventoryMovementType[] = ['OPENING_BALANCE', 'PURCHASE', 'RETURN', 'TRANSFER_IN'];
const STOCK_OUT_TYPES: InventoryMovementType[] = ['DAMAGE', 'LOSS', 'TRANSFER_OUT'];

/**
 * Record a stock movement (admin only).
 *
 * Contract: `quantity` is a positive magnitude for every type; the server
 * applies the sign. ADJUSTMENT instead takes `countedQuantity` (the physical
 * count) and derives the delta. SALE, SERVICE_CONSUMPTION and MIGRATED_USAGE
 * are rejected — only the sale engine (Phase 2) and migrations may post them.
 */
export async function POST(request: Request) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiBadRequest('Tenant context is required.', 400);
  }
  const body = await request.json().catch(() => null);
  const type = body?.type as InventoryMovementType | undefined;

  if (type === 'SALE' || type === 'SERVICE_CONSUMPTION') {
    return apiBadRequest(`${type} movements are posted by the sale engine, not directly.`);
  }
  if (type === 'MIGRATED_USAGE') {
    return apiBadRequest('MIGRATED_USAGE is reserved for legacy data migration.');
  }
  if (!type || ![...STOCK_IN_TYPES, ...STOCK_OUT_TYPES, 'ADJUSTMENT'].includes(type)) {
    return apiBadRequest('type must be a supported inventory movement type.');
  }
  if (typeof body?.productId !== 'string' || !body.productId.trim()) {
    return apiBadRequest('productId is required.');
  }

  try {
    const created = await updateStore((store) => {
      ensureCatalogProjection(store);
      const base = {
        tenantId: session.tenant!.id,
        productId: String(body.productId).trim(),
        reason: typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : null,
        createdBy: session.user.id,
      };

      if (type === 'ADJUSTMENT') {
        const countedQuantity = parseProductQuantityInput(body?.countedQuantity, 'countedQuantity');
        if (!base.reason) {
          throw new SaleValidationError('missing-name', 'reason', 'Adjustments require a reason.');
        }
        return adjustProductStock(store, { ...base, countedQuantity });
      }

      if (type === 'OPENING_BALANCE') {
        const quantity = parseProductQuantityInput(body?.quantity, 'quantity');
        if (quantity <= 0) {
          throw new SaleValidationError('invalid-quantity', 'quantity', 'Opening balance must be a positive whole number.');
        }
        return postOpeningBalance(store, { ...base, quantity });
      }

      const magnitude = parseProductQuantityInput(body?.quantity, 'quantity');
      if (magnitude <= 0) {
        throw new SaleValidationError('invalid-quantity', 'quantity', 'Movement quantity must be a positive whole number.');
      }
      // Server applies the sign: callers never submit negative deltas.
      const quantity = STOCK_OUT_TYPES.includes(type) ? -magnitude : magnitude;
      return postInventoryMovement(store, { ...base, type, quantity });
    });

    return apiCreated(created);
  } catch (error) {
    if (error instanceof SaleValidationError || error instanceof InventoryError) {
      return apiBadRequest(error.message);
    }
    throw error;
  }
}
