export type HaposRuntimeBackend = 'file' | 'postgres';

import { hasDatabaseUrl } from '@/server/db/config';

function normalizeConfiguredMode(value: string | undefined) {
  const normalized = (value ?? 'auto').trim().toLowerCase();
  return normalized === 'postgres' || normalized === 'file' ? normalized : 'auto';
}

export function getRuntimeBackend(): HaposRuntimeBackend {
  const configuredMode = normalizeConfiguredMode(process.env.HAPOS_RUNTIME_MODE);

  if (configuredMode === 'postgres') {
    return 'postgres';
  }

  if (configuredMode === 'file') {
    return 'file';
  }

  return hasDatabaseUrl() ? 'postgres' : 'file';
}

export function getRuntimeModeHeader() {
  return getRuntimeBackend();
}

export function shouldUseSecureCookies() {
  return process.env.NODE_ENV === 'production' || process.env.HAPOS_COOKIE_SECURE === 'true' || Boolean(process.env.VERCEL);
}
