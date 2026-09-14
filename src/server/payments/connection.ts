/**
 * Payment connection domain (Phase 4B).
 *
 * A PaymentConnection is the first-class link
 *
 *   HAPOS tenant → PaymentOS tenant (merchant) → payment account
 *
 * replacing the Phase 4 assumption of one global PAYMENTOS_MERCHANT_ID.
 * The domain owns the vocabulary, the secret-sealing mechanism and the
 * public view (no secret material ever crosses this boundary).
 *
 * Dependency-free except node:crypto: runs under `node --test`.
 * Vocabulary MUST match db/migrations/phase-04b-payment-connections.sql
 * (guarded by scripts/verify-phase-migrations.js).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// ── vocabulary ──────────────────────────────────────────────────────────────

export type PaymentConnectionProvider = 'PAYMENTOS';

export type PaymentConnectionEnvironment = 'SANDBOX' | 'PRODUCTION';

/**
 * Lifecycle: NOT_CONNECTED means "no usable connection exists" (either no
 * row or a disconnected one). Only CONNECTED may initiate live M-Pesa
 * payments. Health is never inferred from populated fields — CONNECTED
 * status is always the result of an explicit verified health check.
 */
export type PaymentConnectionStatus =
  | 'NOT_CONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'ERROR'
  | 'DISCONNECTED';

export const CONNECTION_PROVIDER_VALUES: readonly PaymentConnectionProvider[] = ['PAYMENTOS'];
export const CONNECTION_ENVIRONMENT_VALUES: readonly PaymentConnectionEnvironment[] = ['SANDBOX', 'PRODUCTION'];
export const CONNECTION_STATUS_VALUES: readonly PaymentConnectionStatus[] = [
  'NOT_CONNECTED',
  'CONNECTING',
  'CONNECTED',
  'ERROR',
  'DISCONNECTED',
];

/** Methods a connection can expose. M-Pesa is the only live one in Phase 4B. */
export type PaymentConnectionMethod = 'MPESA';

export type ConnectionErrorCode =
  | 'connection-not-found'
  | 'connection-not-connected'
  | 'connection-invalid-secret'
  | 'connection-environment-mismatch'
  | 'connection-secret-unavailable'
  | 'connection-verification-failed'
  | 'connection-tenant-mismatch';

export class PaymentConnectionError extends Error {
  readonly code: ConnectionErrorCode;

  constructor(code: ConnectionErrorCode, message: string) {
    super(message);
    this.name = 'PaymentConnectionError';
    this.code = code;
  }
}

// ── entity ──────────────────────────────────────────────────────────────────

/**
 * Persisted connection row. Secret material travels ONLY in the
 * `<provider>Secret` sealed fields; mappers and API views strip them.
 */
export type OpsPaymentConnection = {
  id: string;
  tenantId: string;
  provider: PaymentConnectionProvider;
  providerTenantId: string | null;
  environment: PaymentConnectionEnvironment;
  status: PaymentConnectionStatus;
  displayName: string | null;
  supportedMethods: PaymentConnectionMethod[];
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  disconnectedAt: string | null;
  lastCheckCode: string | null;
  lastCheckMessage: string | null;
  secretSealed: string | null;
  webhookSecretSealed: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Connection without any secret material — safe for UI/API responses. */
export type PublicPaymentConnection = Omit<OpsPaymentConnection, 'secretSealed' | 'webhookSecretSealed'>;

/** Non-secret public view. Never include sealed blobs or plaintext. */
export function toPublicConnection(row: OpsPaymentConnection): PublicPaymentConnection {
  const { secretSealed: _s, webhookSecretSealed: _w, ...pub } = row;
  void _s;
  void _w;
  return pub;
}

/** Admin UI presentation: is M-Pesa usable right now? */
export function isMpesaAvailable(connection: Pick<PublicPaymentConnection, 'status' | 'supportedMethods'>): boolean {
  return connection.status === 'CONNECTED' && connection.supportedMethods.includes('MPESA');
}

// ── secret sealing (same trust class as QR_WRAP_KEY / JWT_SECRET) ──────────

const SEALED_VERSION = 'v1';
const KEY_BYTES = 32;

/** Parse a 64-hex-char wrap key. Throws on any other shape. */
export function parseConnectionWrapKey(raw: unknown): Buffer {
  const text = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{64}$/.test(text)) {
    throw new PaymentConnectionError('connection-invalid-secret', 'PAYMENTOS_WRAP_KEY must be 64 hex characters (32 bytes).');
  }
  return Buffer.from(text, 'hex');
}

/**
 * Resolve the connection wrap key: PAYMENTOS_WRAP_KEY first, QR_WRAP_KEY as
 * fallback (one key ceremony can cover both), null when unconfigured —
 * callers degrade to refusal, never to plaintext storage.
 */
export function getConnectionWrapKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const raw = env.PAYMENTOS_WRAP_KEY ?? env.QR_WRAP_KEY;
  if (!raw) {
    return null;
  }
  try {
    return parseConnectionWrapKey(raw);
  } catch {
    return null;
  }
}

/** Seal a provider secret: `v1.<base64 iv>.<base64 ciphertext+tag>`. */
export function sealConnectionSecret(secret: string, key: Buffer): string {
  assertWrapKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SEALED_VERSION}.${iv.toString('base64')}.${Buffer.concat([ciphertext, tag]).toString('base64')}`;
}

/** Open a sealed provider secret. Any failure → connection-secret-unavailable. */
export function openConnectionSecret(sealed: string | null | undefined, key: Buffer | null): string {
  if (!sealed || !key) {
    throw new PaymentConnectionError('connection-secret-unavailable', 'Payment connection secret is not available.');
  }
  try {
    const [version, ivB64, payloadB64] = sealed.split('.');
    if (version !== SEALED_VERSION || !ivB64 || !payloadB64) {
      throw new Error('shape');
    }
    const iv = Buffer.from(ivB64, 'base64');
    const payload = Buffer.from(payloadB64, 'base64');
    if (iv.length !== 12 || payload.length < 17) {
      throw new Error('shape');
    }
    const ciphertext = payload.subarray(0, payload.length - 16);
    const tag = payload.subarray(payload.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    if (!plaintext) {
      throw new Error('empty');
    }
    return plaintext;
  } catch {
    throw new PaymentConnectionError('connection-secret-unavailable', 'Payment connection secret cannot be opened.');
  }
}

function assertWrapKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new PaymentConnectionError('connection-invalid-secret', 'Connection wrap key must be 32 bytes.');
  }
}

// ── validation ──────────────────────────────────────────────────────────────

export type ConnectPaymentOSInput = {
  providerTenantId: string;
  apiKey: string;
  webhookSecret: string;
  environment: PaymentConnectionEnvironment;
  displayName?: string | null;
};

export function assertConnectInput(raw: unknown): ConnectPaymentOSInput {
  const input = (raw ?? {}) as Record<string, unknown>;
  const providerTenantId = typeof input.providerTenantId === 'string' ? input.providerTenantId.trim() : '';
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  const webhookSecret = typeof input.webhookSecret === 'string' ? input.webhookSecret.trim() : '';
  const environment = typeof input.environment === 'string' ? input.environment.trim().toUpperCase() : '';
  if (!providerTenantId || providerTenantId.length > 128) {
    throw new PaymentConnectionError('connection-verification-failed', 'PaymentOS tenant id is required.');
  }
  if (apiKey.length < 16) {
    throw new PaymentConnectionError('connection-verification-failed', 'Paste the PaymentOS API key generated by the platform.');
  }
  if (webhookSecret.length < 16) {
    throw new PaymentConnectionError('connection-verification-failed', 'Paste the PaymentOS webhook signing secret generated by the platform.');
  }
  if (environment !== 'SANDBOX' && environment !== 'PRODUCTION') {
    throw new PaymentConnectionError('connection-verification-failed', 'Connection environment must be SANDBOX or PRODUCTION.');
  }
  const displayName = typeof input.displayName === 'string' && input.displayName.trim() ? input.displayName.trim().slice(0, 120) : null;
  return { providerTenantId, apiKey, webhookSecret, environment: environment as PaymentConnectionEnvironment, displayName };
}

/**
 * Diagnostic reducer for health-check outcomes. Stores only non-sensitive,
 * fixed-vocabulary codes + messages — never provider payloads, keys or PII.
 */
export function connectionCheckFailure(reason: 'unauthorized' | 'environment-mismatch' | 'unreachable' | 'no-mpesa-account'): {
  code: string;
  message: string;
} {
  switch (reason) {
    case 'unauthorized':
      return { code: 'CREDENTIALS_REJECTED', message: 'PaymentOS rejected the API key for this tenant id.' };
    case 'environment-mismatch':
      return { code: 'ENVIRONMENT_MISMATCH', message: 'PaymentOS accounts are not in the selected environment.' };
    case 'unreachable':
      return { code: 'UNREACHABLE', message: 'PaymentOS did not respond to the connection test.' };
    case 'no-mpesa-account':
      return { code: 'NO_MPESA_ACCOUNT', message: 'No M-Pesa payment account is configured for this PaymentOS tenant.' };
  }
}
