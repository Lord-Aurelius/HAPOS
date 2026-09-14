/**
 * PaymentOS HTTP adapter (Phase 4B) — rewritten to the VERIFIED contract.
 *
 * Verified against the attached PaymentOS source
 * (docs/paymentos-merchant-connection.md). Key differences from the Phase 4
 * assumptions, all source-verified:
 *
 * - auth is `x-api-key` + tenant_id (NOT Bearer / merchant_id),
 * - initiation is POST {base}/api/payments with integer-KES `amount`,
 * - correlation/idempotency: PaymentOS replays the same payment for a
 *   repeated idempotency key (or tenant+invoice pair) instead of erroring,
 * - health probe: GET /api/payment-accounts with x-api-key + tenant_id
 *   (200 = authenticated; body carries non-secret account list),
 * - webhooks are signed with the tenant webhook secret:
 *   `x-paymentos-signature: t=<unix>,v1=<hmac_sha256(canonical-json)>`,
 *   canonical JSON = recursively key-sorted (verified in
 *   PaymentOS src/security/webhookSignature.ts).
 *
 * Per-connection config (base URL may stay global; api key, tenant id and
 * webhook secret are tenant-scoped and supplied by the resolved
 * PaymentConnection). Secrets live in sealed storage only and are never
 * logged or returned.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  GatewayError,
  type GatewayCallbackEvent,
  type GatewayHealthInput,
  type GatewayInitiateInput,
  type GatewayInitiateResult,
  type GatewayStatus,
  type GatewayVerifyResult,
  type PaymentGateway,
} from './gateway.ts';

export type PaymentOSConfig = {
  baseUrl: string;
  apiKey: string;
  tenantId: string;
  webhookSecret: string;
  timeoutMs: number;
};

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortKeys((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
}

/** Verify a PaymentOS webhook signature exactly as PaymentOS signs them. */
export function verifyPaymentOSWebhook(
  payload: unknown,
  signatureHeader: string | undefined,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  if (!signatureHeader) return false;
  const timestamp = signatureHeader.match(/(?:^|,)t=([^,]+)/)?.[1];
  const provided = signatureHeader.match(/(?:^|,)v1=([^,]+)/)?.[1];
  if (!timestamp || !provided) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${canonicalJson(payload)}`)
    .digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const providedBuffer = Buffer.from(provided, 'hex');
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

/** Build the signature header for tests (mirrors PaymentOS signing). */
export function signPaymentOSWebhook(payload: unknown, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const digest = createHmac('sha256', secret).update(`${timestamp}.${canonicalJson(payload)}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

function mapEventStatus(event: string): GatewayStatus {
  switch (event) {
    case 'payment.completed':
      return 'SUCCESS';
    case 'payment.failed':
      return 'FAILED';
    case 'payment.cancelled':
      return 'CANCELLED';
    case 'payment.expired':
      return 'EXPIRED';
    default:
      return 'UNKNOWN';
  }
}

let paymentOSFetchOverride: typeof fetch | null = null;

/**
 * Test hook: override the fetch implementation used by every adapter that
 * does not receive an explicit one. Pass null to restore global fetch.
 * Never call from production code paths.
 */
export function setPaymentOSFetchForTests(fetchImpl: typeof fetch | null): void {
  paymentOSFetchOverride = fetchImpl;
}

export class PaymentOSAdapter implements PaymentGateway {
  readonly provider = 'PAYMENTOS' as const;

  private readonly config: PaymentOSConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: PaymentOSConfig, fetchImpl?: typeof fetch) {
    this.config = config;
    // Explicit injection wins (unit tests), then the process-wide test hook,
    // then global fetch.
    this.fetchImpl = fetchImpl ?? paymentOSFetchOverride ?? fetch;
  }

  private async request(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.config.apiKey,
          ...(init.headers ?? {}),
        },
      });
      if (response.status === 401 || response.status === 403) {
        throw new GatewayError('callback-unauthenticated', 'PaymentOS rejected the tenant API key.');
      }
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok) {
        throw new GatewayError('gateway-rejected', `PaymentOS rejected the request (HTTP ${response.status}).`);
      }
      if (!body || typeof body !== 'object') {
        throw new GatewayError('gateway-malformed', 'PaymentOS returned an unreadable response.');
      }
      return body;
    } catch (error) {
      if (error instanceof GatewayError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GatewayError('gateway-timeout', 'PaymentOS did not respond in time.');
      }
      throw new GatewayError('gateway-malformed', 'PaymentOS request failed before a readable response.');
    } finally {
      clearTimeout(timer);
    }
  }

  async initiatePayment(input: GatewayInitiateInput): Promise<GatewayInitiateResult> {
    // PaymentOS takes integer KES base units; HAPOS computes authoritative
    // decimal totals, so round half-up to whole KES and let the callback
    // amount assertion compare against the same rounded value.
    const amountKes = Math.round(input.amount);
    if (amountKes <= 0) {
      throw new GatewayError('gateway-rejected', 'PaymentOS requires a positive integer KES amount.');
    }
    const body = await this.request('/api/payments', {
      method: 'POST',
      body: JSON.stringify({
        tenant_id: input.tenantId ?? this.config.tenantId,
        invoice_id: input.reference ?? input.idempotencyKey,
        account_reference: input.reference ?? undefined,
        phone: input.customerPhone,
        amount: amountKes,
        currency: input.currency,
        description: input.description ?? undefined,
        idempotency_key: input.idempotencyKey,
        metadata: input.metadata ?? {},
      }),
    });

    const payment = (body.payment ?? body) as Record<string, unknown>;
    const providerRequestId = typeof payment.id === 'string' ? payment.id : null;
    if (!providerRequestId) {
      throw new GatewayError('gateway-malformed', 'PaymentOS initiation carried no payment id.');
    }
    return {
      providerRequestId,
      providerReference: typeof payment.mpesa_receipt === 'string' ? payment.mpesa_receipt : null,
      expiresAt: null,
    };
  }

  async verifyPayment(providerRequestId: string): Promise<GatewayVerifyResult> {
    const body = await this.request(`/api/payments/${encodeURIComponent(providerRequestId)}/status?tenant_id=${encodeURIComponent(this.config.tenantId)}`, {
      method: 'GET',
    });
    const payment = (body.payment ?? body) as Record<string, unknown>;
    const raw = typeof payment.status === 'string' ? payment.status.toUpperCase() : '';
    const status: GatewayStatus =
      raw === 'PAID' || raw === 'SUCCESS'
        ? 'SUCCESS'
        : raw === 'FAILED'
          ? 'FAILED'
          : raw === 'CANCELLED'
            ? 'CANCELLED'
            : raw === 'EXPIRED'
              ? 'EXPIRED'
              : 'PENDING';
    return {
      status,
      providerReference: typeof payment.provider_receipt === 'string' ? payment.provider_receipt : typeof payment.mpesa_receipt === 'string' ? payment.mpesa_receipt : null,
      amount: typeof payment.amount_base === 'number' ? payment.amount_base : typeof payment.amount === 'number' ? payment.amount : null,
      currency: typeof payment.currency === 'string' ? payment.currency : null,
      failureCode: typeof payment.failure_reason === 'string' ? payment.failure_reason : null,
      failureReason: typeof payment.failure_reason === 'string' ? payment.failure_reason : null,
    };
  }

  /**
   * Connection health probe: authenticated GET of the tenant's payment
   * accounts. 200 proves key + tenant; the account list proves an M-Pesa
   * destination exists and reports its environment for the mismatch check.
   */
  async checkHealth(input: GatewayHealthInput): Promise<{ connected: boolean; mpesaAccount: { id: string; displayName: string | null; environment: string | null } | null; failure: 'unauthorized' | 'unreachable' | null }> {
    void input;
    try {
      const body = await this.request(`/api/payment-accounts?tenant_id=${encodeURIComponent(this.config.tenantId)}`, {
        method: 'GET',
      });
      const accounts = Array.isArray(body.payment_accounts) ? (body.payment_accounts as Record<string, unknown>[]) : [];
      const mpesa = accounts.find((account) => {
        const method = String(account.payment_method ?? account.account_type ?? '').toUpperCase();
        return method === 'PAYBILL' || method === 'BUY_GOODS' || method === 'TILL' || method === 'POCHI_LA_BIASHARA' || method === 'POCHI';
      }) ?? null;
      return {
        connected: true,
        mpesaAccount: mpesa
          ? {
              id: String(mpesa.id ?? ''),
              displayName: typeof mpesa.display_name === 'string' ? mpesa.display_name : null,
              environment: typeof mpesa.environment === 'string' ? mpesa.environment.toUpperCase() : null,
            }
          : null,
        failure: null,
      };
    } catch (error) {
      if (error instanceof GatewayError && error.code === 'callback-unauthenticated') {
        return { connected: false, mpesaAccount: null, failure: 'unauthorized' };
      }
      return { connected: false, mpesaAccount: null, failure: 'unreachable' };
    }
  }

  /**
   * Parse + authenticate an inbound PaymentOS webhook. Signature is verified
   * with THIS connection's webhook secret over the canonical JSON body; the
   * provider request id is `paymentId`; correlation to HAPOS happens via the
   * payment record (never a body-supplied tenant id).
   */
  parseCallback(rawBody: string, headers: Record<string, string | undefined>): GatewayCallbackEvent {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw new GatewayError('gateway-malformed', 'PaymentOS callback is not valid JSON.');
    }

    if (!verifyPaymentOSWebhook(parsed, headers['x-paymentos-signature'] ?? headers['X-PaymentOS-Signature'], this.config.webhookSecret)) {
      throw new GatewayError('callback-unauthenticated', 'PaymentOS webhook signature mismatch.');
    }

    const providerRequestId = typeof parsed.paymentId === 'string' ? parsed.paymentId : null;
    if (!providerRequestId) {
      throw new GatewayError('gateway-malformed', 'PaymentOS webhook carries no paymentId.');
    }
    const status = typeof parsed.event === 'string' ? mapEventStatus(parsed.event) : 'UNKNOWN';
    return {
      providerRequestId,
      providerReference: typeof parsed.providerReceipt === 'string' ? parsed.providerReceipt : null,
      amount: typeof parsed.amount === 'number' ? parsed.amount : null,
      currency: typeof parsed.currency === 'string' ? parsed.currency : null,
      status,
      failureCode: status === 'SUCCESS' ? null : 'PROVIDER_REPORTED_FAILURE',
      failureReason: status === 'SUCCESS' ? null : `PaymentOS reported ${parsed.event}.`,
      rawBody,
    };
  }
}
