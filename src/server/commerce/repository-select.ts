/**
 * Repository selector (Phase 4).
 *
 * SQL (PostgresCommerceRepository) is authoritative whenever a database URL
 * is configured; otherwise the file adapter preserves local development.
 * Callers depend on the CommerceRepository interface only.
 *
 * App-only module (imports the store runtime + pool): verified by tsc +
 * build. Adapter behavior is verified by unit tests (pure ops) and live
 * database tests (SQL adapter).
 */

import type { Pool } from 'pg';

import { getPool } from '@/server/db/client';
import { getRuntimeBackend } from '@/server/runtime';
import { FileCommerceRepository } from '@/server/commerce/file-repository';
import { PostgresCommerceRepository } from '@/server/commerce/postgres-repository';
import type { CommerceRepository } from '@/server/commerce/repository';

let fileRepository: FileCommerceRepository | null = null;
let sqlRepository: PostgresCommerceRepository | null = null;

export function getCommerceRepository(): CommerceRepository {
  if (getRuntimeBackend() === 'postgres') {
    const pool = getPool();
    if (!pool) {
      throw new Error('A Postgres connection string is required when HAPOS_RUNTIME_MODE=postgres.');
    }
    if (!sqlRepository) {
      sqlRepository = new PostgresCommerceRepository(pool);
    }
    return sqlRepository;
  }

  if (!fileRepository) {
    fileRepository = new FileCommerceRepository();
  }
  return fileRepository;
}

/** Test seam: build a SQL repository against an explicit pool. */
export function createSqlRepository(pool: Pool): CommerceRepository {
  return new PostgresCommerceRepository(pool);
}
