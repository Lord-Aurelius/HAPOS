/**
 * PaymentOS HTTP adapter (Phase 4).
 *
 * ASSUMPTIONS (no PaymentOS interface is visible from this repository —
 * confirm each against staging before live use; the mock provider covers
 * everything else):
 * - base URL + API key + merchant id from environment,
 * - POST {base}/v1/stk/initiate {merchant_id, amount, currency,
 *   customer_phone, reference, callback_url, idempotency_key} →
 *   {request_id, provider_reference?, expires_at?},
 * - GET {base}/v1/payments/{request_id} → {status, provider_reference?,
 *   amount?, currency?, failure_code?, failure_reason?} with status in
 *   {PENDING,SUCCESS,FAILED,EXPIRED} (anything else maps to UNKNOWN),
 * - callbacks POST JSON with an HMAC-SHA256 hex signature of the raw body
 *   in the `x-paymentos-signature` header, keyed by PAYMENTOS_CALLBACK_SECRET.
 *
 * Secrets live in environment only and are never logged or returned.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  GatewayError,
  type GatewayCallbackEvent,
  type GatewayInitiateInput,
  type GatewayInitiateResult,
  type GatewayStatus,
  type GatewayVerifyResult,
  type PaymentGateway,
} from './gateway.ts';

export type PaymentOSConfig = {
  baseUrl: string;
  apiKey: string;
  merchantId: string;
  callbackSecret: string;
  timeoutMs: number;
};

export function paymentOSConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): PaymentOSConfig | null {
  const baseUrl = (env.PAYMENTOS_BASE_URL ?? '').trim().replace(/\/+$/, '');
  const apiKey = (env.PAYMENTOS_API_KEY ?? '').trim();
  const merchantId = (env.PAYMENTOS_MERCHANT_ID ?? '').trim();
  const callbackSecret = (env.PAYMENTOS_CALLBACK_SECRET ?? '').trim();
  const timeoutMs = Number(env.PAYMENTOS_TIMEOUT_MS ?? 15000);
  if (!baseUrl || !apiKey || !merchantId || !callbackSecret) {
    return null;
  }
  return { baseUrl, apiKey, merchantId, callbackSecret, timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 15000 };
}

function mapStatus(raw: unknown): GatewayStatus {
  if (raw === 'PENDING' || raw === 'SUCCESS' || raw === 'FAILED' || raw === 'EXPIRED') {
    return raw;
  }
  return 'UNKNOWN';
}

function asFiniteNumber(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function asText(raw: unknown): string | null {
  return typeof raw === 'string' && raw ? raw : null;
}

export class PaymentOSAdapter implements PaymentGateway {
  readonly provider = 'PAYMENTOS' as const;

  private readonly config: PaymentOSConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: PaymentOSConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  static fromEnv(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch): PaymentOSAdapter {
    const config = paymentOSConfigFromEnv(env);
    if (!config) {
      throw new GatewayError(
        'gateway-unconfigured',
        'PaymentOS is not configured (PAYMENTOS_BASE_URL/API_KEY/MERCHANT_ID/CALLBACK_SECRET).',
      );
    }
    return new PaymentOSAdapter(config, fetchImpl);
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
          ...(init.headers ?? {}),
        },
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok) {
        throw new GatewayError(
          'gateway-rejected',
          `PaymentOS rejected the request (HTTP ${response.status}).`,
        );
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
    const body = await this.request('/v1/stk/initiate', {
      method: 'POST',
      body: JSON.stringify({
        merchant_id: this.config.merchantId,
        amount: input.amount,
        currency: input.currency,
        customer_phone: input.customerPhone,
        reference: input.idempotencyKey,
        callback_url: input.callbackUrl,
        idempotency_key: input.idempotencyKey,
        metadata: input.metadata ?? {},
      }),
    }) as Record<string, unknown>;

    const providerRequestId = asText(body.request_id);
    if (!providerRequestId) {
      throw new GatewayError('gateway-malformed', 'PaymentOS initiation carried no request id.');
    }
    return {
      providerRequestId,
      providerReference: asText(body.provider_reference),
      expiresAt: asText(body.expires_at),
    };
  }

  async verifyPayment(providerRequestId: string): Promise<GatewayVerifyResult> {
    const body = (await this.request(`/v1/payments/${encodeURIComponent(providerRequestId)}`, {
      method: 'GET',
    })) as Record<string, unknown>;
    return {
      status: mapStatus(body.status),
      providerReference: asText(body.provider_reference),
      amount: asFiniteNumber(body.amount),
      currency: asText(body.currency),
      failureCode: asText(body.failure_code),
      failureReason: asText(body.failure_reason),
    };
  }

  parseCallback(rawBody: string, headers: Record<string, string | undefined>): GatewayCallbackEvent {
    const signature = headers['x-paymentos-signature'] ?? headers['X-PaymentOS-Signature'] ?? '';
    const expected = createHmac('sha256', this.config.callbackSecret).update(rawBody, 'utf8').digest('hex');
    const presented = Buffer.from(signature, 'utf8');
    const digest = Buffer.from(expected, 'utf8');
    if (presented.length !== digest.length || !timingSafeEqual(presented, digest)) {
      throw new GatewayError('callback-unauthenticated', 'PaymentOS callback signature mismatch.');
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw new GatewayError('gateway-malformed', 'PaymentOS callback is not valid JSON.');
    }
    const providerRequestId = asText(parsed.request_id);
    if (!providerRequestId) {
      throw new GatewayError('gateway-malformed', 'PaymentOS callback carries no request id.');
    }
    return {
      providerRequestId,
      providerReference: asText(parsed.provider_reference),
      amount: asFiniteNumber(parsed.amount),
      currency: asText(parsed.currency),
      status: mapStatus(parsed.status),
      failureCode: asText(parsed.failure_code),
      failureReason: asText(parsed.failure_reason),
      rawBody,
    };
  }
}
