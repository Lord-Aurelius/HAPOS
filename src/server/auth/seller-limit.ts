import { NextResponse } from 'next/server';

import { createRateLimiter } from '@/server/auth/rate-limit';

// Shared seller-QR throttle (Phase 3): 60 resolutions/submissions per 10
// minutes per credential reference. Reuses the Phase 0 limiter factory —
// no independent limiter implementation. Coarse by design: failures and
// successes share the budget so responses never reveal credential existence.
const sellerLimiter = createRateLimiter({ maxAttempts: 60, windowMs: 10 * 60 * 1000 });

export function checkSellerRateLimit(publicReference: string): boolean {
  return sellerLimiter.attempt(`seller-qr::${publicReference.trim().toLowerCase()}`).allowed;
}

export function sellerRateLimitedResponse() {
  return NextResponse.json(
    { error: 'Too many attempts. Wait a few minutes and try again.', code: 'rate-limited' },
    { status: 429 },
  );
}
