/**
 * Mock payment provider (Phase 4 testing only).
 *
 * Simulates PaymentOS initiation/verification/callbacks for local
 * development and automated tests. It NEVER touches real money and MUST
 * never back production traffic: construction throws in production unless
 * explicitly overridden for a sandbox that is not customer-facing.
 *
 * No STK, no Daraja, no network. State transitions are driven by explicit
 * test hooks (completeIntent / failIntent / expireIntent) or by signed
 * test callbacks built with buildTestCallback.
 */

import { createHmac } from 'node:crypto';

import {
  GatewayError,
  type GatewayCallbackEvent,
  type GatewayHealthInput,
  type GatewayHealthResult,
  type GatewayInitiateInput,
  type GatewayInitiateResult,
  type GatewayStatus,
  type GatewayVerifyResult,
  type PaymentGateway,
} from './gateway.ts';

export type MockIntentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';

type MockIntent = {
  providerRequestId: string;
  providerReference: string | null;
  amount: number;
  currency: string;
  customerPhone: string;
  status: MockIntentStatus;
  failureCode: string | null;
  failureReason: string | null;
  expiresAt: string | null;
};

export function mockProviderGuard(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV === 'production' && env.PAYMENTOS_MOCK_ALLOW !== 'sandbox') {
    throw new GatewayError(
      'mock-forbidden',
      'MockPaymentProvider is refused in production. Configure PaymentOS.',
    );
  }
}

export class MockPaymentProvider implements PaymentGateway {
  readonly provider = 'MOCK' as const;

  private intents = new Map<string, MockIntent>();
  private sequence = 0;

  constructor(env: Record<string, string | undefined> = process.env) {
    mockProviderGuard(env);
  }

  async initiatePayment(input: GatewayInitiateInput): Promise<GatewayInitiateResult> {
    this.sequence += 1;
    const providerRequestId = `mock-req-${this.sequence}`;
    this.intents.set(providerRequestId, {
      providerRequestId,
      providerReference: `MOCK${String(this.sequence).padStart(6, '0')}`,
      amount: input.amount,
      currency: input.currency,
      customerPhone: input.customerPhone,
      status: 'PENDING',
      failureCode: null,
      failureReason: null,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    return {
      providerRequestId,
      providerReference: this.intents.get(providerRequestId)?.providerReference ?? null,
      expiresAt: this.intents.get(providerRequestId)?.expiresAt ?? null,
    };
  }

  async verifyPayment(providerRequestId: string): Promise<GatewayVerifyResult> {
    const intent = this.intents.get(providerRequestId) ?? null;
    if (!intent) {
      return { status: 'UNKNOWN', providerReference: null, amount: null, currency: null, failureCode: null, failureReason: null };
    }
    return {
      status: intent.status,
      providerReference: intent.providerReference,
      amount: intent.amount,
      currency: intent.currency,
      failureCode: intent.failureCode,
      failureReason: intent.failureReason,
    };
  }

  async checkHealth(_input: GatewayHealthInput): Promise<GatewayHealthResult> {
    // The mock is always "configured": one fake M-Pesa destination in the
    // caller-claimed environment so the admin connection test has a path in
    // local/file mode.
    return {
      connected: true,
      mpesaAccount: {
        id: 'mock-account-1',
        displayName: 'Mock M-Pesa destination',
        environment: _input.environment ?? 'SANDBOX',
      },
      failure: null,
    };
  }

  parseCallback(rawBody: string, _headers: Record<string, string | undefined>): GatewayCallbackEvent {
    // Mock callbacks carry no signature: they are only ever produced by
    // buildTestCallback in tests, never accepted over HTTP in production.
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const providerRequestId = typeof parsed.request_id === 'string' ? parsed.request_id : '';
    if (!providerRequestId) {
      throw new GatewayError('gateway-malformed', 'Mock callback carries no request id.');
    }
    const status = parsed.status as GatewayStatus;
    return {
      providerRequestId,
      providerReference: typeof parsed.provider_reference === 'string' ? parsed.provider_reference : null,
      amount: typeof parsed.amount === 'number' ? parsed.amount : null,
      currency: typeof parsed.currency === 'string' ? parsed.currency : null,
      status: status === 'SUCCESS' || status === 'FAILED' || status === 'EXPIRED' ? status : 'PENDING',
      failureCode: typeof parsed.failure_code === 'string' ? parsed.failure_code : null,
      failureReason: typeof parsed.failure_reason === 'string' ? parsed.failure_reason : null,
      rawBody,
    };
  }

  // ── test hooks (drive the lifecycle explicitly) ──

  completeIntent(providerRequestId: string): void {
    this.setIntent(providerRequestId, 'SUCCESS', null, null);
  }

  failIntent(providerRequestId: string, code = 'MOCK_DECLINED', reason = 'Customer declined (mock).'): void {
    this.setIntent(providerRequestId, 'FAILED', code, reason);
  }

  expireIntent(providerRequestId: string): void {
    this.setIntent(providerRequestId, 'EXPIRED', 'MOCK_TIMEOUT', 'Prompt expired (mock).');
  }

  buildTestCallback(providerRequestId: string): { rawBody: string; headers: Record<string, string> } {
    const intent = this.intents.get(providerRequestId);
    if (!intent) {
      throw new GatewayError('gateway-malformed', 'Unknown mock intent.');
    }
    return {
      rawBody: JSON.stringify({
        request_id: intent.providerRequestId,
        provider_reference: intent.providerReference,
        amount: intent.amount,
        currency: intent.currency,
        status: intent.status,
        failure_code: intent.failureCode,
        failure_reason: intent.failureReason,
      }),
      headers: {},
    };
  }

  private setIntent(providerRequestId: string, status: MockIntentStatus, code: string | null, reason: string | null): void {
    const intent = this.intents.get(providerRequestId);
    if (!intent) {
      throw new GatewayError('gateway-malformed', 'Unknown mock intent.');
    }
    intent.status = status;
    intent.failureCode = code;
    intent.failureReason = reason;
  }
}

/** HMAC helper for PaymentOS-shaped test callbacks (mirrors the adapter). */
export function signTestCallback(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}
