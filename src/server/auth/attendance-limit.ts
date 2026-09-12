import { NextResponse } from 'next/server';

import { createRateLimiter } from '@/server/auth/rate-limit';

// Shared public-terminal throttle (Phase 2A): 30 attempts per 10 minutes per
// terminal reference. Enumeration friction for employee numbers — the same
// limiter backs server actions and API routes so the budget is shared.
const terminalLimiter = createRateLimiter({ maxAttempts: 30, windowMs: 10 * 60 * 1000 });

export function checkAttendanceRateLimit(reference: string): boolean {
  return terminalLimiter.attempt(`attendance::${reference.trim().toLowerCase()}`).allowed;
}

export function attendanceRateLimitedResponse() {
  return NextResponse.json(
    { error: 'Too many attempts. Wait a few minutes and try again.', code: 'rate-limited' },
    { status: 429 },
  );
}
