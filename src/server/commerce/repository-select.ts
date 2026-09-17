/**
 * Repository selector (Phase 4, corrected).
 *
 * The file adapter is authoritative in every runtime for now. In postgres
 * mode it persists to `app.runtime_state` (JSONB inside Postgres), so cloud
 * durability and multi-instance sharing are preserved — only the relational
 * commerce tables are bypassed.
 *
 * Why not SQL: no app flow writes the relational commerce tables (tenants,
 * users, catalog, seller_credentials) — every writer targets the JSON runtime
 * store — so the SQL adapter reads empty/stale tables in production. Routing
 * commerce traffic to SQL broke seller-QR scanning, hid QR-submitted orders
 * from the Sellers/Orders pages, and crashed those pages outright. Re-enable
 * the SQL adapter here only together with a real data migration (backfill +
 * dual-write); until then it stays available via `createSqlRepository` for
 * live-database tests and staging verification. Callers depend on the
 * CommerceRepository interface only.
 *
 * App-only module (imports the store runtime + pool): verified by tsc +
 * build. Adapter behavior is verified by unit tests (pure ops) and live
 * database tests (SQL adapter).
 */

import type { Pool } from 'pg';

import { FileCommerceRepository } from '@/server/commerce/file-repository';
import { PostgresCommerceRepository } from '@/server/commerce/postgres-repository';
import type { CommerceRepository } from '@/server/commerce/repository';

let fileRepository: FileCommerceRepository | null = null;

export function getCommerceRepository(): CommerceRepository {
  if (!fileRepository) {
    fileRepository = new FileCommerceRepository();
  }
  return fileRepository;
}

/** Test seam: build a SQL repository against an explicit pool. */
export function createSqlRepository(pool: Pool): CommerceRepository {
  return new PostgresCommerceRepository(pool);
}
