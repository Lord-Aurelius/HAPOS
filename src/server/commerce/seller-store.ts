/**
 * Seller credential persistence operations (Phase 3, unit 4).
 *
 * All functions run INSIDE one `updateStore` mutator (file projection) or one
 * relational transaction (future SQL adapter, guarded by the partial-unique
 * active-credential index). Plaintext bearers exist only as function results
 * for the one-time issuance/rotation ceremony — never persisted, never
 * logged, never returned by reads.
 *
 * Operates on minimal structural store types: runs under `node --test`.
 */

import { randomUUID } from 'node:crypto';

import {
  SellerError,
  assertCredentialFresh,
  assertValidSellerReference,
  buildSellerReference,
  generateSellerBearer,
  hashSellerBearer,
} from './seller.ts';

export type SellerUser = {
  id: string;
  tenantId: string | null;
  role?: string;
  isActive: boolean;
};

export type SellerCredentialRow = {
  id: string;
  tenantId: string;
  sellerId: string;
  publicReference: string;
  tokenHash: string;
  status: string;
  issuedAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  expiresAt?: string | null;
  rotatedAt?: string | null;
  rotatedFromId?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SellerCredentialStore = {
  users: SellerUser[];
  sellerCredentials: SellerCredentialRow[];
};

export type SellerContext = {
  now?: string;
  generateId?: () => string;
  bearerHex?: string;
  referenceHex?: string;
};

function contextNow(ctx: SellerContext): string {
  return ctx.now ?? new Date().toISOString();
}

function contextId(ctx: SellerContext): string {
  return (ctx.generateId ?? randomUUID)();
}

function requireActiveSeller(store: SellerCredentialStore, tenantId: string, sellerId: string) {
  const seller = store.users.find((item) => item.id === sellerId) ?? null;
  if (!seller || seller.tenantId !== tenantId) {
    throw new SellerError('unknown-seller', 'Seller not found for this shop.');
  }
  if (seller.role !== undefined && seller.role !== 'staff' && seller.role !== 'shop_admin') {
    throw new SellerError('unknown-seller', 'Seller not found for this shop.');
  }
  if (!seller.isActive) {
    throw new SellerError('inactive-seller', 'That seller account is inactive.');
  }
  return seller;
}

function activeCredentialOf(store: SellerCredentialStore, tenantId: string, sellerId: string) {
  return store.sellerCredentials.find(
    (item) => item.tenantId === tenantId && item.sellerId === sellerId && item.status === 'ACTIVE',
  ) ?? null;
}

export type IssuedCredential = {
  credential: SellerCredentialRow;
  /** Plaintext bearer for ONE-TIME display. Never persisted. */
  bearer: string;
};

function mintCredential(
  store: SellerCredentialStore,
  input: { tenantId: string; sellerId: string; createdBy?: string | null; expiresAt?: string | null; rotatedFromId?: string | null },
  ctx: SellerContext,
): IssuedCredential {
  const now = contextNow(ctx);
  const bearer = generateSellerBearer(ctx.bearerHex);
  const credential: SellerCredentialRow = {
    id: contextId(ctx),
    tenantId: input.tenantId,
    sellerId: input.sellerId,
    publicReference: buildSellerReference(ctx.referenceHex),
    tokenHash: hashSellerBearer(bearer),
    status: 'ACTIVE',
    issuedAt: now,
    lastUsedAt: null,
    revokedAt: null,
    expiresAt: input.expiresAt ?? null,
    rotatedAt: null,
    rotatedFromId: input.rotatedFromId ?? null,
    createdBy: input.createdBy ?? null,
    createdAt: now,
    updatedAt: now,
  };
  store.sellerCredentials.push(credential);
  return { credential, bearer };
}

/**
 * Issue a seller QR credential. Fails when the seller already holds an
 * active credential — rotation is the replacement path.
 */
export function issueSellerCredential(
  store: SellerCredentialStore,
  input: { tenantId: string; sellerId: string; createdBy?: string | null; expiresAt?: string | null },
  ctx: SellerContext = {},
): IssuedCredential {
  requireActiveSeller(store, input.tenantId, input.sellerId);
  if (activeCredentialOf(store, input.tenantId, input.sellerId)) {
    throw new SellerError('credential-active', 'That seller already has an active QR credential. Rotate it instead.');
  }
  return mintCredential(store, input, ctx);
}

/**
 * Rotate: the old credential is revoked immediately (same mutator) and a new
 * bearer is issued. Historical transactions keep referencing seller_id, so
 * they stay valid.
 */
export function rotateSellerCredential(
  store: SellerCredentialStore,
  input: { tenantId: string; sellerId: string; createdBy?: string | null; expiresAt?: string | null },
  ctx: SellerContext = {},
): IssuedCredential {
  requireActiveSeller(store, input.tenantId, input.sellerId);
  const now = contextNow(ctx);
  const previous = activeCredentialOf(store, input.tenantId, input.sellerId);
  if (previous) {
    previous.status = 'REVOKED';
    previous.revokedAt = now;
    previous.rotatedAt = now;
    previous.updatedAt = now;
  }
  const issued = mintCredential(store, { ...input, rotatedFromId: previous?.id ?? null }, ctx);
  if (previous) {
    issued.credential.rotatedFromId = previous.id;
  }
  return issued;
}

/** Revoke the seller's active credential. Future QR use fails immediately. */
export function revokeSellerCredential(
  store: SellerCredentialStore,
  input: { tenantId: string; sellerId: string },
  ctx: SellerContext = {},
): SellerCredentialRow {
  const credential = activeCredentialOf(store, input.tenantId, input.sellerId);
  if (!credential) {
    throw new SellerError('invalid-reference', 'That seller has no active QR credential.');
  }
  const now = contextNow(ctx);
  credential.status = 'REVOKED';
  credential.revokedAt = now;
  credential.updatedAt = now;
  return credential;
}

export type VerifiedSellerContext = {
  tenantId: string;
  sellerId: string;
  credentialId: string;
  publicReference: string;
};

/**
 * Verify a presented QR bearer. Checks, in order: reference shape, row
 * existence, tenant match, ACTIVE status, hash match, expiry, seller
 * active. Any failure is a rejection — the reason code stays coarse to
 * avoid credential-existence oracles.
 */
export function verifySellerCredential(
  store: SellerCredentialStore,
  input: { tenantId: string; reference: unknown; bearer: unknown },
  ctx: SellerContext = {},
): VerifiedSellerContext {
  const reference = assertValidSellerReference(input.reference);
  const bearer = typeof input.bearer === 'string' ? input.bearer : '';
  const credential = store.sellerCredentials.find((item) => item.publicReference === reference) ?? null;
  if (!credential || credential.tenantId !== input.tenantId) {
    throw new SellerError('invalid-reference', 'This seller QR code is not recognized.');
  }
  if (credential.status !== 'ACTIVE') {
    throw new SellerError('credential-revoked', 'This seller QR code is no longer active.');
  }
  if (!bearer || credential.tokenHash !== hashSellerBearer(bearer)) {
    throw new SellerError('invalid-bearer', 'This seller QR code is not recognized.');
  }
  const now = contextNow(ctx);
  assertCredentialFresh(credential.expiresAt ?? null, now);
  requireActiveSeller(store, input.tenantId, credential.sellerId);
  return {
    tenantId: credential.tenantId,
    sellerId: credential.sellerId,
    credentialId: credential.id,
    publicReference: credential.publicReference,
  };
}

/** Record credential use at transaction time (never on mere resolution). */
export function touchSellerCredentialUsed(
  store: SellerCredentialStore,
  input: { tenantId: string; credentialId: string },
  ctx: SellerContext = {},
): void {
  const credential = store.sellerCredentials.find(
    (item) => item.id === input.credentialId && item.tenantId === input.tenantId,
  ) ?? null;
  if (credential) {
    credential.lastUsedAt = contextNow(ctx);
    credential.updatedAt = credential.lastUsedAt;
  }
}
