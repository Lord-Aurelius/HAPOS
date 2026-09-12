import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAttendanceTerminalUrl,
  buildCustomerBookingUrl,
  buildSellerTransactionUrl,
  getPublicAppBaseUrl,
} from '../src/server/config/public-url.ts';

describe('getPublicAppBaseUrl (environment-derived)', () => {
  it('prefers PUBLIC_APP_URL and trims trailing slashes', () => {
    assert.equal(
      getPublicAppBaseUrl({ PUBLIC_APP_URL: 'https://shop.example.com///' } as unknown as NodeJS.ProcessEnv),
      'https://shop.example.com',
    );
  });

  it('falls back to VERCEL_URL with https', () => {
    assert.equal(
      getPublicAppBaseUrl({ VERCEL_URL: 'hapos-test.vercel.app' } as unknown as NodeJS.ProcessEnv),
      'https://hapos-test.vercel.app',
    );
  });

  it('uses localhost in non-production when nothing is configured', () => {
    assert.equal(getPublicAppBaseUrl({ NODE_ENV: 'test' } as unknown as NodeJS.ProcessEnv), 'http://localhost:3000');
    assert.equal(
      getPublicAppBaseUrl({ NODE_ENV: 'development', PORT: '4000' } as unknown as NodeJS.ProcessEnv),
      'http://localhost:4000',
    );
  });

  it('never advertises a hardcoded host in production without configuration', () => {
    const base = getPublicAppBaseUrl({ NODE_ENV: 'production' } as unknown as unknown as NodeJS.ProcessEnv);
    assert.equal(base, '');
    assert.ok(!base.includes('onrender.com'));
  });
});

describe('URL builders share one configuration', () => {
  const env = { PUBLIC_APP_URL: 'https://shop.example.com' } as unknown as NodeJS.ProcessEnv;

  it('builds booking URLs from the configured base', () => {
    assert.equal(buildCustomerBookingUrl('test-shop', env), 'https://shop.example.com/book/test-shop');
  });

  it('degrades to relative paths when no base is configured', () => {
    const relative = { NODE_ENV: 'production' } as unknown as unknown as NodeJS.ProcessEnv;
    assert.equal(buildCustomerBookingUrl('test-shop', relative), '/book/test-shop');
  });

  it('builds future seller-transaction URLs from the same base', () => {
    assert.equal(buildSellerTransactionUrl('token-abc', env), 'https://shop.example.com/sell/token-abc');
  });

  it('builds attendance terminal URLs carrying reference and bearer', () => {
    const url = buildAttendanceTerminalUrl('att-shop-abc123', 'tokendata', env);
    assert.equal(url, 'https://shop.example.com/attendance/att-shop-abc123?k=tokendata');
  });
});
