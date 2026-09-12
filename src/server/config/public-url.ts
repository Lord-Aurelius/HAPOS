/**
 * Centralised public application URL configuration (Phase 0.5).
 *
 * Single source of truth for every externally visible URL: customer booking
 * links today, seller-QR transaction URLs in a later phase. All builders in
 * this module read only non-secret configuration (never API keys or session
 * material), so their output is safe to embed in pages and QR payloads.
 *
 * Resolution order:
 * 1. `PUBLIC_APP_URL` (explicit per-environment setting),
 * 2. `NEXT_PUBLIC_APP_URL` (Vercel-style public override),
 * 3. `VERCEL_URL` (host only → prefixed with `https://`),
 * 4. dev/test fallback `http://localhost:3000` when `NODE_ENV !== 'production'`,
 * 5. empty string (relative-path mode) when production has no configured URL
 *    rather than silently advertising the wrong host.
 */

function readConfiguredUrl(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim().replace(/\/+$/, '');
  return trimmed ? trimmed : null;
}

export function getPublicAppBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = readConfiguredUrl(env.PUBLIC_APP_URL) ?? readConfiguredUrl(env.NEXT_PUBLIC_APP_URL);
  if (explicit) {
    return explicit;
  }

  const vercelHost = readConfiguredUrl(env.VERCEL_URL);
  if (vercelHost) {
    return vercelHost.startsWith('http') ? vercelHost : `https://${vercelHost}`;
  }

  if (env.NODE_ENV !== 'production') {
    const port = readConfiguredUrl(env.PORT) ?? '3000';
    return `http://localhost:${port}`;
  }

  return '';
}

export function buildCustomerBookingUrl(slug: string, env?: NodeJS.ProcessEnv): string {
  const path = `/book/${slug}`;
  const baseUrl = getPublicAppBaseUrl(env);
  return baseUrl ? `${baseUrl}${path}` : path;
}

/**
 * Placeholder builder reserved for the Phase 3 seller-QR workflow. The token
 * is opaque transaction intent (never a session id) — route implementation
 * belongs to Phase 3; centralising the builder now guarantees the QR payload
 * host can never diverge from booking links.
 */
export function buildSellerTransactionUrl(token: string, env?: NodeJS.ProcessEnv): string {
  const path = `/sell/${token}`;
  const baseUrl = getPublicAppBaseUrl(env);
  return baseUrl ? `${baseUrl}${path}` : path;
}

/**
 * Attendance terminal URL (Phase 2A). The reference is public; `token` is the
 * revocable terminal bearer embedded in the QR payload. It authenticates the
 * terminal context ONLY — never an employee, session, or admin capability.
 */
export function buildAttendanceTerminalUrl(reference: string, token: string, env?: NodeJS.ProcessEnv): string {
  const path = `/attendance/${reference}?k=${encodeURIComponent(token)}`;
  const baseUrl = getPublicAppBaseUrl(env);
  return baseUrl ? `${baseUrl}${path}` : path;
}
