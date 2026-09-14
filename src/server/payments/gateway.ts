/**
 * Payment gateway boundary (Phase 4B).
 *
 * The commerce domain depends ONLY on this narrow interface. All PaymentOS
 * HTTP lives in `paymentos.ts`; tests and local development use
 * `mock-provider.ts`. No route, action, order engine or inventory code may
 * import provider implementations directly.
 *
 * Phase 4B: tenant-scoped gateway construction. The gateway no longer reads
 * a global PAYMENTOS_MERCHANT_ID — the payment service resolves the
 * tenant's active PaymentConnection and passes its secret material into the
 * adapter per request.
 */

export type GatewayInitiateInput = {
  /** Server-authoritative amount (never browser-supplied). */
  amount: number;
  currency: string;
  /** E.164 customer phone for the STK prompt. */
  customerPhone: string;
  /** PaymentOS tenant id (merchant identity) — from the active connection. */
  tenantId?: string;
  /** HAPOS business reference carried through to PaymentOS (invoice_id). */
  reference?: string;
  /** HAPOS payment idempotency key (one per attempt). */
  idempotencyKey: string;
  /** Absolute callback URL PaymentOS will POST results to. */
  callbackUrl: string | null;
  description?: string;
  metadata?: Record<string, string>;
};

export type GatewayInitiateResult = {
  providerRequestId: string;
  providerReference: string | null;
  expiresAt: string | null;
};

export type GatewayStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED' | 'CANCELLED' | 'UNKNOWN';

export type GatewayVerifyResult = {
  status: GatewayStatus;
  providerReference: string | null;
  amount: number | null;
  currency: string | null;
  failureCode: string | null;
  failureReason: string | null;
};

export type GatewayCallbackEvent = {
  providerRequestId: string;
  providerReference: string | null;
  amount: number | null;
  currency: string | null;
  status: GatewayStatus;
  failureCode: string | null;
  failureReason: string | null;
  rawBody: string;
};

export type GatewayHealthInput = {
  /** Expected environment (SANDBOX|PRODUCTION) for the mismatch check. */
  environment?: string;
};

export type GatewayHealthResult = {
  connected: boolean;
  /** First M-Pesa destination account found (non-secret fields only). */
  mpesaAccount: { id: string; displayName: string | null; environment: string | null } | null;
  failure: 'unauthorized' | 'unreachable' | null;
};

export type GatewayErrorCode =
  | 'gateway-unconfigured'
  | 'gateway-rejected'
  | 'gateway-timeout'
  | 'gateway-malformed'
  | 'callback-unauthenticated'
  | 'mock-forbidden';

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;

  constructor(code: GatewayErrorCode, message: string) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
  }
}

export interface PaymentGateway {
  readonly provider: 'PAYMENTOS' | 'MOCK';
  initiatePayment(input: GatewayInitiateInput): Promise<GatewayInitiateResult>;
  verifyPayment(providerRequestId: string): Promise<GatewayVerifyResult>;
  /** Connection health probe (connection test in the admin UI). */
  checkHealth(input: GatewayHealthInput): Promise<GatewayHealthResult>;
  /** Parse + authenticate an inbound callback. Throws on any doubt. */
  parseCallback(rawBody: string, headers: Record<string, string | undefined>): GatewayCallbackEvent;
}
