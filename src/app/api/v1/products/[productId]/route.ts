import { apiBadRequest, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { assertSkuUnique, validateProductInput } from '@/server/commerce/catalog';
import { ensureCatalogProjection } from '@/server/commerce/inventory-store';
import { SaleValidationError } from '@/server/commerce/sale-validation';
import { updateStore } from '@/server/store';

type RouteProps = {
  params: Promise<{ productId: string }>;
};

export async function PATCH(request: Request, { params }: RouteProps) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiBadRequest('Tenant context is required.', 400);
  }

  const { productId } = await params;
  const body = await request.json().catch(() => null);

  try {
    const updated = await updateStore((store) => {
      ensureCatalogProjection(store);
      const product = store.products.find(
        (item) => item.id === productId && item.tenantId === session.tenant!.id,
      );
      if (!product) {
        throw new SaleValidationError('missing-id', 'productId', 'Product not found for this shop.');
      }

      // Merge-then-validate: absent fields keep their stored values, so
      // partial updates get the same strict rules as full creates. Quantity
      // is never editable here — use the inventory adjustment endpoints.
      const validated = validateProductInput({
        name: body?.name ?? product.name,
        description: body?.description ?? product.description,
        sku: body?.sku ?? product.sku,
        unitCost: body?.unitCost ?? product.unitCost,
        sellingPrice: body?.sellingPrice ?? product.sellingPrice,
        reorderLevel: body?.reorderLevel ?? product.reorderLevel,
        criticalLevel: body?.criticalLevel ?? product.criticalLevel,
      });
      assertSkuUnique(store.products, session.tenant!.id, validated.sku, product.id);

      product.name = validated.name;
      product.description = validated.description;
      product.unitCost = validated.unitCost;
      product.sku = validated.sku;
      product.sellingPrice = validated.sellingPrice;
      product.reorderLevel = validated.reorderLevel;
      product.criticalLevel = validated.criticalLevel;
      if (typeof body?.isActive === 'boolean') {
        product.isActive = body.isActive;
      }
      product.updatedAt = new Date().toISOString();
      return product;
    });

    return apiOk(updated);
  } catch (error) {
    if (error instanceof SaleValidationError) {
      return apiBadRequest(error.message);
    }
    throw error;
  }
}
