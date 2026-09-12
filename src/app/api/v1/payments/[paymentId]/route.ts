import { apiBadRequest, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { getCommerceRepository } from '@/server/commerce/repository-select';

type RouteProps = {
  params: Promise<{ paymentId: string }>;
};

export async function GET(_: Request, { params }: RouteProps) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiBadRequest('Tenant context is required.', 400);
  }
  const { paymentId } = await params;
  const repo = getCommerceRepository();
  const payment = await repo.getPaymentByIdGlobal(paymentId);
  if (!payment || payment.tenantId !== session.tenant.id) {
    return apiBadRequest('Payment not found.', 404);
  }
  return apiOk(payment);
}
