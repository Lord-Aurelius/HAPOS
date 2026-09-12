/**
 * Payment gateway boundary (Phase 4).
 *
 * The commerce domain depends ONLY on this narrow interface. All PaymentOS
 * HTTP lives in `paymentos.ts`; tests and local development use
 * `mock-provider.ts`. No route, action, order engine or inventory code may
 * import provider implementations directly.
 */

export type GatewayInitiateInput = {
  /** Server-authoritative amount (never browser-supplied). */
  amount: number;
  currency: string;
  /** E.164 customer phone for the STK prompt. */
  customerPhone: string;
  /** HAPOS merchant identifier as known to PaymentOS (adapter defaults it). */
  merchantId?: string;
  /** HAPOS payment idempotency key (one per attempt). */
  idempotencyKey: string;
  /** Absolute callback URL PaymentOS will POST results to. */
  callbackUrl: string | null;
  metadata?: Record<string, string>;
};

export type GatewayInitiateResult = {
  providerRequestId: string;
  providerReference: string | null;
  expiresAt: string | null;
};

export type GatewayStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED' | 'UNKNOWN';

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
  /** Parse + authenticate an inbound callback. Throws on any doubt. */
  parseCallback(rawBody: string, headers: Record<string, string | undefined>): GatewayCallbackEvent;
}
