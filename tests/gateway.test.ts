import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GatewayError } from '../src/server/payments/gateway.ts';
import { MockPaymentProvider, mockProviderGuard, signTestCallback } from '../src/server/payments/mock-provider.ts';
import { PaymentOSAdapter, paymentOSConfigFromEnv } from '../src/server/payments/paymentos.ts';

function assertGatewayCode(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (error: unknown) => error instanceof GatewayError && error.code === code,
    `expected GatewayError ${code}`,
  );
}

function assertGatewayCodeAsync(fn: () => Promise<unknown>, code: string) {
  return assert.rejects(
    fn,
    (error: unknown) => error instanceof GatewayError && error.code === code,
    `expected GatewayError ${code}`,
  );
}

type StubSpec = {
  status?: number;
  body?: unknown;
  throws?: Error;
  hang?: boolean;
  seen?: { url: string; init: RequestInit }[];
};

function stubFetch(spec: StubSpec): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    (spec.seen ??= []).push({ url: String(url), init: init ?? {} });
    if (spec.hang) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
    if (spec.throws) {
      throw spec.throws;
    }
    return {
      ok: (spec.status ?? 200) >= 200 && (spec.status ?? 200) < 300,
      status: spec.status ?? 200,
      json: async () => spec.body ?? null,
    } as Response;
  }) as typeof fetch;
}

const CONFIG = {
  baseUrl: 'https://payos.example',
  apiKey: 'test-key',
  merchantId: 'merchant-1',
  callbackSecret: 'callback-secret',
  timeoutMs: 1000,
};

describe('paymentOSConfigFromEnv', () => {
  it('requires the full credential set and trims the base URL', () => {
    const config = paymentOSConfigFromEnv({
      PAYMENTOS_BASE_URL: 'https://payos.example///',
      PAYMENTOS_API_KEY: 'k',
      PAYMENTOS_MERCHANT_ID: 'm',
      PAYMENTOS_CALLBACK_SECRET: 's',
    });
    assert.equal(config?.baseUrl, 'https://payos.example');
    assert.equal(
      paymentOSConfigFromEnv({ PAYMENTOS_BASE_URL: 'https://x', PAYMENTOS_API_KEY: 'k' }),
      null,
    );
    assert.throws(() => PaymentOSAdapter.fromEnv({}), GatewayError);
  });
});

describe('PaymentOSAdapter.initiatePayment', () => {
  it('sends the server-owned amount with auth and idempotency', async () => {
    const spec: StubSpec = { body: { request_id: 'req-1', provider_reference: 'REF1', expires_at: '2026-01-01T00:00:00Z' } };
    const adapter = new PaymentOSAdapter(CONFIG, stubFetch(spec));
    const result = await adapter.initiatePayment({
      amount: 1850,
      currency: 'KES',
      customerPhone: '+254712345678',
      merchantId: 'merchant-1',
      idempotencyKey: 'pay-order-1-1',
      callbackUrl: 'https://shop.example/api/v1/payments/callback',
    });
    assert.equal(result.providerRequestId, 'req-1');
    const sent = JSON.parse(String((spec.seen?.[0]?.init as RequestInit).body));
    assert.equal(sent.amount, 1850);
    assert.equal(sent.idempotency_key, 'pay-order-1-1');
    assert.equal((spec.seen?.[0]?.init?.headers as Record<string, string>).authorization, 'Bearer test-key');
  });

  it('maps rejection, timeout and malformed responses', async () => {
    await assertGatewayCodeAsync(
      () => new PaymentOSAdapter(CONFIG, stubFetch({ status: 402, body: { error: 'nope' } })).initiatePayment({
        amount: 10, currency: 'KES', customerPhone: '+254700000000', merchantId: 'm', idempotencyKey: 'k', callbackUrl: null,
      }),
      'gateway-rejected',
    );
    await assertGatewayCodeAsync(
      () => new PaymentOSAdapter(CONFIG, stubFetch({ hang: true })).initiatePayment({
        amount: 10, currency: 'KES', customerPhone: '+254700000000', merchantId: 'm', idempotencyKey: 'k', callbackUrl: null,
      }),
      'gateway-timeout',
    );
    await assertGatewayCodeAsync(
      () => new PaymentOSAdapter(CONFIG, stubFetch({ body: { no_request: true } })).initiatePayment({
        amount: 10, currency: 'KES', customerPhone: '+254700000000', merchantId: 'm', idempotencyKey: 'k', callbackUrl: null,
      }),
      'gateway-malformed',
    );
  });
});

describe('PaymentOSAdapter.verifyPayment', () => {
  it('maps known statuses and quarantines the rest as UNKNOWN', async () => {
    const ok = new PaymentOSAdapter(
      CONFIG,
      stubFetch({ body: { status: 'SUCCESS', provider_reference: 'R', amount: 1850, currency: 'KES' } }),
    );
    assert.deepEqual(await ok.verifyPayment('req-1'), {
      status: 'SUCCESS', providerReference: 'R', amount: 1850, currency: 'KES', failureCode: null, failureReason: null,
    });
    const weird = new PaymentOSAdapter(CONFIG, stubFetch({ body: { status: 'WEIRD' } }));
    assert.equal((await weird.verifyPayment('req-1')).status, 'UNKNOWN');
  });
});

describe('PaymentOSAdapter.parseCallback', () => {
  const rawBody = JSON.stringify({ request_id: 'req-9', provider_reference: 'R9', amount: 500, currency: 'KES', status: 'SUCCESS' });

  it('accepts correctly signed callbacks', () => {
    const adapter = new PaymentOSAdapter(CONFIG, stubFetch({}));
    const event = adapter.parseCallback(rawBody, { 'x-paymentos-signature': signTestCallback(rawBody, 'callback-secret') });
    assert.equal(event.providerRequestId, 'req-9');
    assert.equal(event.status, 'SUCCESS');
    assert.equal(event.amount, 500);
  });

  it('rejects forged, missing and malformed callbacks', () => {
    const adapter = new PaymentOSAdapter(CONFIG, stubFetch({}));
    assertGatewayCode(() => adapter.parseCallback(rawBody, { 'x-paymentos-signature': 'forged' }), 'callback-unauthenticated');
    assertGatewayCode(() => adapter.parseCallback(rawBody, {}), 'callback-unauthenticated');
    assertGatewayCode(
      () => adapter.parseCallback('not-json', { 'x-paymentos-signature': signTestCallback('not-json', 'callback-secret') }),
      'gateway-malformed',
    );
  });
});

describe('MockPaymentProvider', () => {
  it('drives the lifecycle explicitly without network', async () => {
    const mock = new MockPaymentProvider({ NODE_ENV: 'test' });
    const initiated = await mock.initiatePayment({
      amount: 1000, currency: 'KES', customerPhone: '+254700000001', merchantId: 'm', idempotencyKey: 'k1', callbackUrl: null,
    });
    assert.equal((await mock.verifyPayment(initiated.providerRequestId)).status, 'PENDING');
    mock.completeIntent(initiated.providerRequestId);
    assert.equal((await mock.verifyPayment(initiated.providerRequestId)).status, 'SUCCESS');

    const { rawBody } = mock.buildTestCallback(initiated.providerRequestId);
    const event = mock.parseCallback(rawBody, {});
    assert.equal(event.status, 'SUCCESS');
    assert.equal(event.amount, 1000);
  });

  it('supports failure and expiry hooks', async () => {
    const mock = new MockPaymentProvider({ NODE_ENV: 'test' });
    const failed = await mock.initiatePayment({
      amount: 100, currency: 'KES', customerPhone: '+254700000001', merchantId: 'm', idempotencyKey: 'k2', callbackUrl: null,
    });
    mock.failIntent(failed.providerRequestId);
    assert.equal((await mock.verifyPayment(failed.providerRequestId)).status, 'FAILED');
    const expired = await mock.initiatePayment({
      amount: 100, currency: 'KES', customerPhone: '+254700000001', merchantId: 'm', idempotencyKey: 'k3', callbackUrl: null,
    });
    mock.expireIntent(expired.providerRequestId);
    assert.equal((await mock.verifyPayment(expired.providerRequestId)).status, 'EXPIRED');
  });

  it('refuses production without an explicit sandbox override', () => {
    assertGatewayCode(() => mockProviderGuard({ NODE_ENV: 'production' }), 'mock-forbidden');
    assert.doesNotThrow(() => mockProviderGuard({ NODE_ENV: 'production', PAYMENTOS_MOCK_ALLOW: 'sandbox' }));
    assert.doesNotThrow(() => mockProviderGuard({ NODE_ENV: 'test' }));
    assert.throws(() => new MockPaymentProvider({ NODE_ENV: 'production' }), GatewayError);
  });
});
