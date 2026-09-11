/**
 * Minimal in-memory authentication rate limiter (Phase 0.9).
 *
 * Purpose: blunt-force protection for the credential endpoints without
 * introducing an external store. Bounded `Map` with lazy expiry so there are
 * no timers (safe under serverless) and memory cannot grow without bound.
 *
 * This is a baseline, not a distributed solution: multi-instance deployments
 * need a shared counter (e.g. Postgres advisory/table-backed) before
 * high-threat exposure. Documented as a remaining gap in the Phase 0 report.
 */

export type RateLimitDecision = {
  allowed: boolean;
  /** Milliseconds until the window resets; 0 when allowed. */
  retryAfterMs: number;
};

type RateLimitEntry = {
  count: number;
  windowStart: number;
};

export function createRateLimiter(options: {
  /** Max attempts per key per window. */
  maxAttempts: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Upper bound on tracked keys (evicts oldest on overflow). */
  maxKeys?: number;
}) {
  const { maxAttempts, windowMs, maxKeys = 5000 } = options;
  const entries = new Map<string, RateLimitEntry>();

  function prune(now: number) {
    for (const [key, entry] of entries) {
      if (now - entry.windowStart >= windowMs) {
        entries.delete(key);
      }
    }
    while (entries.size > maxKeys) {
      const oldest = entries.keys().next();
      if (oldest.done) {
        break;
      }
      entries.delete(oldest.value);
    }
  }

  function attempt(key: string, now: number = Date.now()): RateLimitDecision {
    prune(now);
    const normalized = key.trim().toLowerCase() || 'unknown';
    const entry = entries.get(normalized);

    if (!entry || now - entry.windowStart >= windowMs) {
      entries.set(normalized, { count: 1, windowStart: now });
      return { allowed: true, retryAfterMs: 0 };
    }

    if (entry.count < maxAttempts) {
      entry.count += 1;
      return { allowed: true, retryAfterMs: 0 };
    }

    return { allowed: false, retryAfterMs: Math.max(0, windowMs - (now - entry.windowStart)) };
  }

  function reset(key: string) {
    entries.delete(key.trim().toLowerCase());
  }

  function size(): number {
    return entries.size;
  }

  return { attempt, reset, size };
}

/** Baseline login policy: 10 attempts per 10 minutes per identity. */
export const LOGIN_WINDOW_MS = 10 * 60 * 1000;
export const LOGIN_MAX_ATTEMPTS = 10;

let sharedLoginLimiter: ReturnType<typeof createRateLimiter> | null = null;

export function getLoginRateLimiter(): ReturnType<typeof createRateLimiter> {
  if (!sharedLoginLimiter) {
    sharedLoginLimiter = createRateLimiter({ maxAttempts: LOGIN_MAX_ATTEMPTS, windowMs: LOGIN_WINDOW_MS });
  }
  return sharedLoginLimiter;
}

/** Scoped key so one username cannot lock out an entire shop (or vice versa). */
export function buildLoginRateLimitKey(businessSlug: string, username: string): string {
  return `${businessSlug.trim().toLowerCase()}::${username.trim().toLowerCase()}`;
}
