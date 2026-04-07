import { Pool } from 'pg';

import { getDatabaseUrl } from '@/server/db/config';

let pool: Pool | null = null;

export function getPool(): Pool | null {
  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      max: Number(process.env.POSTGRES_POOL_MAX ?? 20),
    });
  }

  return pool;
}

export async function withDb<T>(work: (pool: Pool) => Promise<T>): Promise<T | null> {
  const currentPool = getPool();
  if (!currentPool) {
    return null;
  }

  return work(currentPool);
}
