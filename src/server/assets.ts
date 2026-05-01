import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PoolClient } from 'pg';

import { getPool } from '@/server/db/client';
import { getDatabaseConfigHint } from '@/server/db/config';
import { getRuntimeBackend } from '@/server/runtime';
import type { StoreState } from '@/server/store/types';

const assetDirectory = path.join(process.cwd(), 'data', 'assets');
const assetRoutePrefix = '/api/v1/assets/';
const assetTableSql = `
create schema if not exists app;

create table if not exists app.asset_blobs (
  id text primary key,
  mime_type text not null,
  bytes bytea not null,
  created_at timestamptz not null default now()
);
`;

type StoredAsset = {
  assetId: string;
  mimeType: string;
  bytes: Buffer;
};

function buildAssetUrl(assetId: string) {
  return `${assetRoutePrefix}${assetId}`;
}

function buildAssetId(prefix = 'asset') {
  return `${prefix}-${randomUUID()}`;
}

function getAssetBytesPath(assetId: string) {
  return path.join(assetDirectory, `${assetId}.bin`);
}

function getAssetMetadataPath(assetId: string) {
  return path.join(assetDirectory, `${assetId}.json`);
}

function parseInlineImageDataUrl(value: string) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(value.trim());
  if (!match) {
    return null;
  }

  try {
    return {
      mimeType: match[1].toLowerCase(),
      bytes: Buffer.from(match[2], 'base64'),
    };
  } catch {
    return null;
  }
}

async function ensureFileAssetDirectory() {
  await mkdir(assetDirectory, { recursive: true });
}

async function ensureAssetTable(client: PoolClient) {
  await client.query(assetTableSql);
}

async function writeFileAsset(input: { assetId: string; mimeType: string; bytes: Buffer }) {
  await ensureFileAssetDirectory();
  await Promise.all([
    writeFile(getAssetBytesPath(input.assetId), input.bytes),
    writeFile(
      getAssetMetadataPath(input.assetId),
      JSON.stringify({ mimeType: input.mimeType }, null, 2),
      'utf8',
    ),
  ]);

  return buildAssetUrl(input.assetId);
}

async function writePostgresAsset(
  input: { assetId: string; mimeType: string; bytes: Buffer },
  client?: PoolClient,
) {
  const pool = getPool();
  if (!pool) {
    throw new Error(
      `A Postgres connection string (${getDatabaseConfigHint()}) is required when HAPOS_RUNTIME_MODE=postgres.`,
    );
  }

  if (client) {
    await ensureAssetTable(client);
    await client.query(
      `
        insert into app.asset_blobs (id, mime_type, bytes)
        values ($1, $2, $3)
        on conflict (id)
        do update set mime_type = excluded.mime_type, bytes = excluded.bytes
      `,
      [input.assetId, input.mimeType, input.bytes],
    );
    return buildAssetUrl(input.assetId);
  }

  const ownedClient = await pool.connect();

  try {
    await ensureAssetTable(ownedClient);
    await ownedClient.query(
      `
        insert into app.asset_blobs (id, mime_type, bytes)
        values ($1, $2, $3)
        on conflict (id)
        do update set mime_type = excluded.mime_type, bytes = excluded.bytes
      `,
      [input.assetId, input.mimeType, input.bytes],
    );
  } finally {
    ownedClient.release();
  }

  return buildAssetUrl(input.assetId);
}

async function readFileAsset(assetId: string): Promise<StoredAsset | null> {
  await ensureFileAssetDirectory();

  try {
    const [bytes, metadataRaw] = await Promise.all([
      readFile(getAssetBytesPath(assetId)),
      readFile(getAssetMetadataPath(assetId), 'utf8'),
    ]);
    const metadata = JSON.parse(metadataRaw) as { mimeType?: string };

    return {
      assetId,
      mimeType: metadata.mimeType ?? 'application/octet-stream',
      bytes,
    };
  } catch {
    return null;
  }
}

async function readPostgresAsset(assetId: string): Promise<StoredAsset | null> {
  const pool = getPool();
  if (!pool) {
    throw new Error(
      `A Postgres connection string (${getDatabaseConfigHint()}) is required when HAPOS_RUNTIME_MODE=postgres.`,
    );
  }

  const client = await pool.connect();

  try {
    await ensureAssetTable(client);
    const result = await client.query('select mime_type, bytes from app.asset_blobs where id = $1', [assetId]);
    if (result.rowCount === 0) {
      return null;
    }

    return {
      assetId,
      mimeType: result.rows[0].mime_type,
      bytes: result.rows[0].bytes,
    };
  } finally {
    client.release();
  }
}

function shouldNormalizeInlineImage(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

async function normalizeAssetField(
  target: { logoUrl?: string | null; imageUrl?: string | null },
  field: 'logoUrl' | 'imageUrl',
  assetPrefix: string,
  client?: PoolClient,
) {
  const currentValue = target[field];
  if (!shouldNormalizeInlineImage(currentValue)) {
    return false;
  }

  const inlineValue = currentValue;
  const normalized = await storeInlineImageDataUrl(inlineValue, { assetPrefix, client });
  if (!normalized) {
    return false;
  }

  target[field] = normalized;
  return true;
}

export function isManagedAssetUrl(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(assetRoutePrefix);
}

export function getAssetIdFromUrl(value: string | null | undefined) {
  if (!isManagedAssetUrl(value)) {
    return null;
  }

  const assetUrl = value;
  return assetUrl.slice(assetRoutePrefix.length) || null;
}

export async function storeImageAsset(input: {
  bytes: Buffer;
  mimeType: string;
  assetId?: string;
  assetPrefix?: string;
  client?: PoolClient;
}) {
  const assetId = input.assetId ?? buildAssetId(input.assetPrefix);

  if (getRuntimeBackend() === 'postgres') {
    return writePostgresAsset(
      {
        assetId,
        mimeType: input.mimeType,
        bytes: input.bytes,
      },
      input.client,
    );
  }

  return writeFileAsset({
    assetId,
    mimeType: input.mimeType,
    bytes: input.bytes,
  });
}

export async function storeInlineImageDataUrl(
  dataUrl: string,
  options: {
    assetId?: string;
    assetPrefix?: string;
    client?: PoolClient;
  } = {},
) {
  const parsed = parseInlineImageDataUrl(dataUrl);
  if (!parsed) {
    return null;
  }

  return storeImageAsset({
    bytes: parsed.bytes,
    mimeType: parsed.mimeType,
    assetId: options.assetId,
    assetPrefix: options.assetPrefix,
    client: options.client,
  });
}

export async function readImageAsset(assetId: string) {
  if (getRuntimeBackend() === 'postgres') {
    return readPostgresAsset(assetId);
  }

  return readFileAsset(assetId);
}

export async function normalizeStoreAssetReferences(store: StoreState, client?: PoolClient) {
  let changed = false;

  for (const tenant of store.tenants) {
    changed = (await normalizeAssetField(tenant, 'logoUrl', `tenant-${tenant.id}`, client)) || changed;
  }

  for (const service of store.services) {
    changed = (await normalizeAssetField(service, 'imageUrl', `service-${service.id}`, client)) || changed;
  }

  for (const advert of store.marketplaceAds) {
    changed = (await normalizeAssetField(advert, 'imageUrl', `advert-${advert.id}`, client)) || changed;
  }

  return changed;
}
