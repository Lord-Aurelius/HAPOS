import { NextResponse } from 'next/server';

import { expireOverduePayments, getPaymentGateway, handlePaymentCallback } from '@/server/payments/payment-service';
import { getCommerceRepository } from '@/server/commerce/repository-select';
import { toServiceError } from '@/server/commerce/order-service';

/**
 * PaymentOS callback endpoint (Phase 4).
 *
 * Authenticity is verified by the gateway BEFORE any database work. The
 * payment is correlated by ?pid= (or the provider request id inside the
 * signed body); everything afterwards re-scopes to the stored row's tenant.
 * Duplicate deliveries converge on the stored outcome. No SMS/AI work happens
 * here — acknowledge the provider fast.
 */
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const pid = searchParams.get('pid');
  const rawBody = await request.text();
  const headers: Record<string, string | undefined> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
    headers[key.toLowerCase()] = value;
  });

  try {
    const repo = getCommerceRepository();
    const gateway = getPaymentGateway();
    // Opportunistic expiry sweep is intentionally NOT here: callbacks must
    // acknowledge fast. Overdue intents expire via the admin sweep action.
    const result = await handlePaymentCallback(repo, gateway, { rawBody, headers, paymentId: pid });
    return NextResponse.json({ ok: true, outcome: result.outcome, paymentId: result.paymentId });
  } catch (error) {
    try {
      const mapped = toServiceError(error);
      return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status });
    } catch {
      return NextResponse.json({ error: 'Callback processing failed.' }, { status: 500 });
    }
  }
}
