/**
 * QR bearer persistence via authenticated encryption (correction loop).
 *
 * Problem: hash-only storage makes an issued QR unrecoverable after the
 * one-time ceremony, but the business requires the SAME active QR to stay
 * printable. Storing the raw bearer would weaken the credential model.
 *
 * Mechanism: AES-256-GCM seal the bearer at issuance/rotation time and store
 * the sealed blob alongside the hash. Verification stays hash-based; the
 * sealed copy is ONLY ever opened inside an authorized QR-render request,
 * in memory, to rebuild the identical QR image. Normal reads, lists, logs
 * and APIs never expose it (mappers strip it exactly like hashes).
 *
 * Key management: 32-byte key from `QR_WRAP_KEY` (64 hex chars, server secret
 * manager — same trust class as JWT_SECRET). Absent/invalid key means the
 * persistent feature degrades to reissue-only (never silent insecurity, never
 * a boot-ephemeral fallback that would confuse operators).
 *
 * Key rotation procedure: change QR_WRAP_KEY, then rotate every credential;
 * stale sealed copies fail-open to "reissue" (never to plaintext, never 500
 * with key detail).
 *
 * Dependency-free except node:crypto: runs under `node --test`.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type QrWrapErrorCode = 'wrap-unavailable' | 'needs-reissue' | 'invalid-key' | 'qr-not-found';

export class QrWrapError extends Error {
  readonly code: QrWrapErrorCode;

  constructor(code: QrWrapErrorCode, message: string) {
    super(message);
    this.name = 'QrWrapError';
    this.code = code;
  }
}

const SEALED_VERSION = 'v1';
const KEY_BYTES = 32;

/** Parse a 64-hex-char wrap key. Throws invalid-key on any other shape. */
export function parseQrWrapKey(raw: unknown): Buffer {
  const text = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{64}$/.test(text)) {
    throw new QrWrapError('invalid-key', 'QR_WRAP_KEY must be 64 hex characters (32 bytes).');
  }
  return Buffer.from(text, 'hex');
}

/** Resolve the wrap key from the environment (or an explicit override). */
export function getQrWrapKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const raw = env.QR_WRAP_KEY;
  if (!raw) {
    return null;
  }
  try {
    return parseQrWrapKey(raw);
  } catch {
    return null;
  }
}

/** Seal a bearer: `v1.<base64 iv>.<base64 ciphertext+tag>`. */
export function sealBearer(bearer: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(bearer, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([ciphertext, tag]).toString('base64');
  return `${SEALED_VERSION}.${iv.toString('base64')}.${payload}`;
}

/** Open a sealed bearer. Any failure means "reissue", never a key detail. */
export function openBearer(sealed: string | null | undefined, key: Buffer | null): string {
  if (!sealed || !key) {
    throw new QrWrapError('needs-reissue', 'Print or reissue the QR code to enable persistent printing.');
  }
  try {
    const [version, ivB64, payloadB64] = sealed.split('.');
    if (version !== SEALED_VERSION || !ivB64 || !payloadB64) {
      throw new QrWrapError('needs-reissue', 'Print or reissue the QR code to enable persistent printing.');
    }
    const iv = Buffer.from(ivB64, 'base64');
    const payload = Buffer.from(payloadB64, 'base64');
    if (iv.length !== 12 || payload.length < 17) {
      throw new QrWrapError('needs-reissue', 'Print or reissue the QR code to enable persistent printing.');
    }
    const ciphertext = payload.subarray(0, payload.length - 16);
    const tag = payload.subarray(payload.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    if (!plaintext) {
      throw new QrWrapError('needs-reissue', 'Print or reissue the QR code to enable persistent printing.');
    }
    return plaintext;
  } catch (error) {
    if (error instanceof QrWrapError) {
      throw error;
    }
    throw new QrWrapError('needs-reissue', 'Print or reissue the QR code to enable persistent printing.');
  }
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new QrWrapError('invalid-key', 'QR wrap key must be 32 bytes.');
  }
}

export type QrRenderSource =
  | { kind: 'explicit'; bearer: string }
  | { kind: 'persistent'; sealed: string | null | undefined; wrapKey: Buffer | null };

/**
 * Resolve the bearer for a QR render request. Explicit one-time bearers pass
 * through (the caller already authorized the ceremony); otherwise the sealed
 * copy is opened. Nothing here ever returns hashes or keys.
 */
export function resolveRenderBearer(source: QrRenderSource): string {
  if (source.kind === 'explicit') {
    if (!source.bearer) {
      throw new QrWrapError('needs-reissue', 'Print or reissue the QR code to enable persistent printing.');
    }
    return source.bearer;
  }
  return openBearer(source.sealed, source.wrapKey);
}

export type QrRenderRow = {
  tenantId: string;
  sealed?: string | null;
};

/**
 * Persistent-render resolution shared by the seller and attendance QR
 * routes: same active credential renders the same QR on every visit.
 * - unknown reference, wrong tenant, or unusable row → qr-not-found (404),
 * - explicit ceremony bearer wins when supplied,
 * - otherwise the sealed copy opens (missing key/copy → needs-reissue/400).
 */
export function resolvePersistentQrBearer(input: {
  row: QrRenderRow | null;
  tenantId: string;
  isUsable: boolean;
  explicitBearer: string | null;
  wrapKey: Buffer | null;
}): string {
  if (!input.row || input.row.tenantId !== input.tenantId || !input.isUsable) {
    throw new QrWrapError('qr-not-found', 'No active QR for that reference.');
  }
  if (input.explicitBearer) {
    return input.explicitBearer;
  }
  return openBearer(input.row.sealed ?? null, input.wrapKey);
}
