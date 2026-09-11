import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLoginRateLimitKey,
  createRateLimiter,
} from '../src/server/auth/rate-limit.ts';

describe('createRateLimiter', () => {
  it('allows attempts up to the limit then blocks', () => {
    const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 60_000 });
    const now = 1_000_000;
    assert.equal(limiter.attempt('shop::user', now).allowed, true);
    assert.equal(limiter.attempt('shop::user', now).allowed, true);
    assert.equal(limiter.attempt('shop::user', now).allowed, true);
    const blocked = limiter.attempt('shop::user', now);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterMs > 0);
  });

  it('resets after the window elapses', () => {
    const limiter = createRateLimiter({ maxAttempts: 1, windowMs: 60_000 });
    assert.equal(limiter.attempt('k', 0).allowed, true);
    assert.equal(limiter.attempt('k', 1).allowed, false);
    assert.equal(limiter.attempt('k', 60_001).allowed, true);
  });

  it('isolates keys from each other', () => {
    const limiter = createRateLimiter({ maxAttempts: 1, windowMs: 60_000 });
    assert.equal(limiter.attempt('a', 0).allowed, true);
    assert.equal(limiter.attempt('a', 1).allowed, false);
    assert.equal(limiter.attempt('b', 1).allowed, true);
  });

  it('supports manual reset after successful login', () => {
    const limiter = createRateLimiter({ maxAttempts: 1, windowMs: 60_000 });
    assert.equal(limiter.attempt('k', 0).allowed, true);
    limiter.reset('k');
    assert.equal(limiter.attempt('k', 1).allowed, true);
  });
});

describe('buildLoginRateLimitKey', () => {
  it('scopes by shop and username case-insensitively', () => {
    assert.equal(buildLoginRateLimitKey('Test-Shop', 'Naomi'), 'test-shop::naomi');
    assert.notEqual(buildLoginRateLimitKey('shop-a', 'naomi'), buildLoginRateLimitKey('shop-b', 'naomi'));
  });
});
