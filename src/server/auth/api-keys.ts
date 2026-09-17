/**
 * AEGIS API-key domain (connection credentials for programmatic access).
 *
 * Secrets are never persisted: rows carry a sha256 hash plus a plaintext
 * lookup prefix; the secret is shown once at creation. Verification is a
 * constant-time hash comparison. Normal keys are bound to one tenant + user
 * and project exactly that user's authority; master keys are platform
 * authority with no tenant binding and must never surface in normal listings.
 *
 * Operates on minimal structural store types: runs under `node --test`.
 * Session/role enforcement for minting (super_admin for master scope) lives
 * here so no caller can mint elevated keys by accident.
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export type ApiKeyScope = 'normal' | 'master';

export type ApiKeyStatus = 'ACTIVE' | 'REVOKED';

export type ApiKeyRow = {
  id: string;
  tenantId: string | null;
  userId: string | null;
  name: string;
  keyHash: string;
  keyPrefix: string;
  scope: ApiKeyScope;
  status: ApiKeyStatus;
  createdBy: string | null;
  createdAt: string;
  expiresAt?: string | null;
  revokedAt?: string | null;
  lastUsedAt?: string | null;
};

export type ApiKeyUser = {
  id: string;
  tenantId: string | null;
  role?: string;
  isActive: boolean;
};

export type ApiKeyStore = {
  users: ApiKeyUser[];
  apiKeys: ApiKeyRow[];
};

export type ApiKeyContext = {
  now?: string;
  generateId?: () => string;
  /** 48 hex chars of entropy for tests; production always uses randomBytes. */
  secretHex?: string;
};

export class ApiKeyError extends Error {
  readonly code: 'invalid-name' | 'invalid-scope' | 'missing-binding' | 'unknown-key' | 'forbidden';
  constructor(
    code: 'invalid-name' | 'invalid-scope' | 'missing-binding' | 'unknown-key' | 'forbidden',
    message: string,
  ) {
    super(message);
    this.name = 'ApiKeyError';
    this.code = code;
  }
}

const SECRET_PREFIX = 'hap_live_';
const SECRET_HEX_CHARS = 48;
const PREFIX_CHARS = 16;

function contextNow(ctx: ApiKeyContext): string {
  return ctx.now ?? new Date().toISOString();
}

function contextId(ctx: ApiKeyContext): string {
  return (ctx.generateId ?? randomUUID)();
}

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

function mintSecret(secretHex?: string): string {
  const cleaned = (secretHex ?? '').replace(/[^a-f0-9]/gi, '').toLowerCase();
  const entropy = cleaned.length >= SECRET_HEX_CHARS ? cleaned.slice(0, SECRET_HEX_CHARS) : randomBytes(24).toString('hex');
  return `${SECRET_PREFIX}${entropy}`;
}

/** A stored row is usable when active, unrevoked and unexpired. */
export function isApiKeyUsable(row: ApiKeyRow, nowISO: string): boolean {
  if (row.status !== 'ACTIVE' || row.revokedAt) {
    return false;
  }
  if (row.expiresAt && Date.parse(row.expiresAt) <= Date.parse(nowISO)) {
    return false;
  }
  return true;
}

export type ResolvedPrincipal =
  | { kind: 'normal'; keyId: string; tenantId: string; userId: string; role: string }
  | { kind: 'master'; keyId: string };

/**
 * Resolve a presented secret to a principal. The bound user's live role is
 * used (role changes propagate to the key); inactive users and cross-tenant
 * bindings resolve to null — fail closed, no oracle beyond invalid/valid.
 */
export function resolveApiKeyPrincipal(
  store: ApiKeyStore,
  secret: unknown,
  ctx: ApiKeyContext = {},
): ResolvedPrincipal | null {
  if (typeof secret !== 'string' || !secret.startsWith(SECRET_PREFIX)) {
    return null;
  }
  const candidates = (store.apiKeys ?? []).filter((row) => row.keyPrefix === secret.slice(0, SECRET_PREFIX.length + PREFIX_CHARS));
  const presented = Buffer.from(hashApiKey(secret), 'utf8');
  let matched: ApiKeyRow | null = null;
  for (const row of candidates) {
    const stored = Buffer.from(row.keyHash, 'utf8');
    if (stored.length === presented.length && timingSafeEqual(stored, presented)) {
      matched = row;
      break;
    }
  }
  if (!matched || !isApiKeyUsable(matched, contextNow(ctx))) {
    return null;
  }
  if (matched.scope === 'master') {
    return { kind: 'master', keyId: matched.id };
  }
  const user = (store.users ?? []).find((item) => item.id === matched.userId) ?? null;
  if (!user || !user.isActive || user.tenantId !== matched.tenantId || typeof user.role !== 'string') {
    return null;
  }
  return { kind: 'normal', keyId: matched.id, tenantId: matched.tenantId as string, userId: user.id, role: user.role };
}

export type MintedApiKey = {
  record: ApiKeyRow;
  /** Plaintext secret for ONE-TIME display. Never persisted. */
  secret: string;
};

/**
 * Mint a key. Normal scope binds tenant + user; master scope requires a
 * super_admin minter and binds neither (platform authority).
 */
export function mintApiKey(
  store: ApiKeyStore,
  input: {
    scope: ApiKeyScope;
    tenantId?: string | null;
    userId?: string | null;
    name: string;
    createdBy: string | null;
    minterRole: string;
    expiresAt?: string | null;
  },
  ctx: ApiKeyContext = {},
): MintedApiKey {
  const name = (input.name ?? '').trim().slice(0, 80);
  if (!name) {
    throw new ApiKeyError('invalid-name', 'Name this API key before creating it.');
  }
  if (input.scope !== 'normal' && input.scope !== 'master') {
    throw new ApiKeyError('invalid-scope', 'API key scope must be normal or master.');
  }
  if (input.scope === 'master') {
    if (input.minterRole !== 'super_admin') {
      throw new ApiKeyError('forbidden', 'Only the platform authority can create master keys.');
    }
    if (input.tenantId || input.userId) {
      throw new ApiKeyError('invalid-scope', 'Master keys are platform-wide and bind no tenant or user.');
    }
  } else {
    if (!input.tenantId || !input.userId) {
      throw new ApiKeyError('missing-binding', 'Normal API keys bind one tenant and one user.');
    }
    const user = (store.users ?? []).find((item) => item.id === input.userId) ?? null;
    if (!user || user.tenantId !== input.tenantId) {
      throw new ApiKeyError('missing-binding', 'The bound user does not belong to that tenant.');
    }
  }

  const secret = mintSecret(ctx.secretHex);
  const now = contextNow(ctx);
  const record: ApiKeyRow = {
    id: contextId(ctx),
    tenantId: input.scope === 'master' ? null : (input.tenantId as string),
    userId: input.scope === 'master' ? null : (input.userId as string),
    name,
    keyHash: hashApiKey(secret),
    keyPrefix: secret.slice(0, SECRET_PREFIX.length + PREFIX_CHARS),
    scope: input.scope,
    status: 'ACTIVE',
    createdBy: input.createdBy,
    createdAt: now,
    expiresAt: input.expiresAt ?? null,
    revokedAt: null,
    lastUsedAt: null,
  };
  (store.apiKeys ??= []).push(record);
  return { record, secret };
}

/** Revoke a key. Master rows revoke only via an explicit master-scope call. */
export function revokeApiKey(
  store: ApiKeyStore,
  input: { id: string; tenantId?: string | null; scope?: ApiKeyScope | null },
  ctx: ApiKeyContext = {},
): ApiKeyRow {
  const row = (store.apiKeys ?? []).find((item) => item.id === input.id) ?? null;
  if (!row) {
    throw new ApiKeyError('unknown-key', 'That API key was not found.');
  }
  if (row.scope === 'master' && input.scope !== 'master') {
    throw new ApiKeyError('forbidden', 'Master keys revoke only through master authority.');
  }
  if (row.scope === 'normal' && input.tenantId && row.tenantId !== input.tenantId) {
    throw new ApiKeyError('unknown-key', 'That API key was not found.');
  }
  if (row.status !== 'REVOKED') {
    row.status = 'REVOKED';
    row.revokedAt = contextNow(ctx);
  }
  return row;
}

export type ApiKeyMetadata = {
  id: string;
  tenantId: string | null;
  userId: string | null;
  name: string;
  keyPrefix: string;
  scope: ApiKeyScope;
  status: ApiKeyStatus;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
};

/** Metadata-only listing. Hashes never leave this boundary. */
export function listApiKeyMetadata(
  store: ApiKeyStore,
  input: { tenantId?: string | null; includeMaster: boolean },
): ApiKeyMetadata[] {
  return (store.apiKeys ?? [])
    .filter((row) => {
      if (row.scope === 'master') {
        return input.includeMaster;
      }
      return !input.tenantId || row.tenantId === input.tenantId;
    })
    .map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      name: row.name,
      keyPrefix: row.keyPrefix,
      scope: row.scope,
      status: row.status,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt ?? null,
      lastUsedAt: row.lastUsedAt ?? null,
    }));
}

/** Throttled last-used touch (at most hourly) so auth stays a cheap read. */
export function touchApiKeyUsed(
  store: ApiKeyStore,
  input: { id: string },
  ctx: ApiKeyContext = {},
): void {
  const row = (store.apiKeys ?? []).find((item) => item.id === input.id) ?? null;
  if (!row) {
    return;
  }
  const nowMs = Date.parse(contextNow(ctx));
  const lastMs = row.lastUsedAt ? Date.parse(row.lastUsedAt) : 0;
  if (!Number.isFinite(nowMs) || nowMs - lastMs < 3_600_000) {
    return;
  }
  row.lastUsedAt = contextNow(ctx);
}
