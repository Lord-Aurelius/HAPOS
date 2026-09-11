import { randomUUID } from 'node:crypto';

import { apiBadRequest, apiCreated, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { assertSkuUnique, validateProductInput } from '@/server/commerce/catalog';
import { ensureCatalogProjection, postOpeningBalance } from '@/server/commerce/inventory-store';
import { InventoryError } from '@/server/commerce/inventory';
import { SaleValidationError, parseProductQuantityInput } from '@/server/commerce/sale-validation';
import { listProducts } from '@/server/services/app-data';
import { updateStore } from '@/server/store';

export async function GET() {
  const session = await requireSession(['shop_admin', 'super_admin']);
  return apiOk({ items: session.tenant ? await listProducts(session.tenant.id) : [] });
}

export async function POST(request: Request) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiCreated(null);
  }
  const body = await request.json().catch(() => null);

  let validated: ReturnType<typeof validateProductInput>;
  let openingQuantity = 0;
  try {
    validated = validateProductInput({
      name: body?.name,
      description: body?.description,
      sku: body?.sku,
      unitCost: body?.unitCost,
      sellingPrice: body?.sellingPrice,
      reorderLevel: body?.reorderLevel,
      criticalLevel: body?.criticalLevel,
    });
    openingQuantity = parseProductQuantityInput(body?.openingQuantity ?? 0, 'openingQuantity');
  } catch (error) {
    if (error instanceof SaleValidationError) {
      return apiBadRequest(error.message);
    }
    throw error;
  }

  try {
    const created = await updateStore((store) => {
      ensureCatalogProjection(store);
      assertSkuUnique(store.products, session.tenant!.id, validated.sku);

      const now = new Date().toISOString();
      const product = {
        id: randomUUID(),
        tenantId: session.tenant!.id,
        name: validated.name,
        unitCost: validated.unitCost,
        description: validated.description,
        isActive: true,
        sku: validated.sku,
        skuGenerated: false,
        sellingPrice: validated.sellingPrice,
        quantityOnHand: 0,
        reorderLevel: validated.reorderLevel,
        criticalLevel: validated.criticalLevel,
        createdAt: now,
        updatedAt: now,
      };
      store.products.push(product);

      if (openingQuantity > 0) {
        postOpeningBalance(
          store,
          {
            tenantId: session.tenant!.id,
            productId: product.id,
            quantity: openingQuantity,
            unitCost: validated.unitCost,
            reason: 'Opening stock on product creation',
            createdBy: session.user.id,
          },
        );
      }

      return product;
    });
    return apiCreated(created);
  } catch (error) {
    if (error instanceof SaleValidationError || error instanceof InventoryError) {
      return apiBadRequest(error.message);
    }
    throw error;
  }
}
