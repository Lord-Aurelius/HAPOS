const pooledConnectionKeys = ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING'] as const;
const directConnectionKeys = ['DATABASE_URL', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_URL'] as const;

function readEnvValue(key: (typeof pooledConnectionKeys)[number]) {
  const value = process.env[key];
  return value && value.trim() ? value.trim() : null;
}

export function getDatabaseUrl(options: { preferDirect?: boolean } = {}) {
  const keys = options.preferDirect ? directConnectionKeys : pooledConnectionKeys;

  for (const key of keys) {
    const value = readEnvValue(key);
    if (value) {
      return value;
    }
  }

  return null;
}

export function hasDatabaseUrl() {
  return Boolean(getDatabaseUrl());
}

export function getDatabaseConfigHint() {
  return 'DATABASE_URL, POSTGRES_URL, or POSTGRES_URL_NON_POOLING';
}
