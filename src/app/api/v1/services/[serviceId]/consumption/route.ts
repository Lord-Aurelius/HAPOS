import { apiBadRequest, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { ensureCatalogProjection, replaceServiceBom } from '@/server/commerce/inventory-store';
import { InventoryError } from '@/server/commerce/inventory';
import { SaleValidationError } from '@/server/commerce/sale-validation';
import { listServiceProductLinks } from '@/server/services/app-data';
import { updateStore } from '@/server/store';

type RouteProps = {
  params: Promise<{ serviceId: string }>;
};

export async function GET(_: Request, { params }: RouteProps) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiOk({ items: [] });
  }
  const { serviceId } = await params;
  const links = (await listServiceProductLinks(session.tenant.id)).filter((link) => link.serviceId === serviceId);
  return apiOk({ items: links });
}

/**
 * Replace a service's consumption definition (admin only).
 * Body: `{ lines: [{ productId, quantity }] }`. Moves no stock — the
 * definition is consumed by future sales only.
 */
export async function PUT(request: Request, { params }: RouteProps) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiBadRequest('Tenant context is required.', 400);
  }

  const { serviceId } = await params;
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.lines)) {
    return apiBadRequest('lines must be an array of { productId, quantity }.');
  }

  try {
    const links = await updateStore((store) => {
      ensureCatalogProjection(store);
      return replaceServiceBom(store, {
        tenantId: session.tenant!.id,
        serviceId,
        lines: body.lines,
      });
    });
    return apiOk({ items: links });
  } catch (error) {
    if (error instanceof SaleValidationError || error instanceof InventoryError) {
      return apiBadRequest(error.message);
    }
    throw error;
  }
}
