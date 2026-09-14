import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GatewayError } from '../src/server/payments/gateway.ts';
import { MockPaymentProvider, mockProviderGuard } from '../src/server/payments/mock-provider.ts';
import { PaymentOSAdapter, signPaymentOSWebhook } from '../src/server/payments/paymentos.ts';

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
  tenantId: 'hapos-shop-1',
  webhookSecret: 'whsec-test-secret',
  timeoutMs: 1000,
};

describe('PaymentOSAdapter.initiatePayment (verified contract)', () => {
  it('authenticates with x-api-key + tenant_id and integer KES amount', async () => {
    const spec: StubSpec = { body: { payment: { id: 'pay_1', status: 'created' } } };
    const adapter = new PaymentOSAdapter(CONFIG, stubFetch(spec));
    const result = await adapter.initiatePayment({
      amount: 1850,
      currency: 'KES',
      customerPhone: '+254712345678',
      tenantId: 'hapos-shop-1',
      idempotencyKey: 'pay-order-1-1',
      callbackUrl: 'https://shop.example/api/v1/payments/callback',
    });
    assert.equal(result.providerRequestId, 'pay_1');
    const sent = JSON.parse(String((spec.seen?.[0]?.init as RequestInit).body));
    assert.equal(sent.tenant_id, 'hapos-shop-1');
    assert.equal(sent.amount, 1850);
    assert.equal(sent.idempotency_key, 'pay-order-1-1');
    assert.ok(String(spec.seen?.[0]?.url).includes('/api/payments'));
    assert.equal((spec.seen?.[0]?.init?.headers as Record<string, string>)['x-api-key'], 'test-key');
    assert.equal((spec.seen?.[0]?.init?.headers as Record<string, string>).authorization, undefined);
  });

  it('maps rejection, timeout and malformed responses', async () => {
    await assertGatewayCodeAsync(
      () => new PaymentOSAdapter(CONFIG, stubFetch({ status: 402, body: { error: 'nope' } })).initiatePayment({
        amount: 10, currency: 'KES', customerPhone: '+254700000000', tenantId: 't', idempotencyKey: 'k', callbackUrl: null,
      }),
      'gateway-rejected',
    );
    await assertGatewayCodeAsync(
      () => new PaymentOSAdapter(CONFIG, stubFetch({ hang: true })).initiatePayment({
        amount: 10, currency: 'KES', customerPhone: '+254700000000', tenantId: 't', idempotencyKey: 'k', callbackUrl: null,
      }),
      'gateway-timeout',
    );
    await assertGatewayCodeAsync(
      () => new PaymentOSAdapter(CONFIG, stubFetch({ body: { unexpected: true } })).initiatePayment({
        amount: 10, currency: 'KES', customerPhone: '+254700000000', tenantId: 't', idempotencyKey: 'k', callbackUrl: null,
      }),
      'gateway-malformed',
    );
  });

  it('refuses non-positive amounts (PaymentOS needs integer base units)', async () => {
    const adapter = new PaymentOSAdapter(CONFIG, stubFetch({}));
    await assertGatewayCodeAsync(
      () => adapter.initiatePayment({ amount: 0, currency: 'KES', customerPhone: '+254700000000', tenantId: 't', idempotencyKey: 'k', callbackUrl: null }),
      'gateway-rejected',
    );
  });
});

describe('PaymentOSAdapter.checkHealth (verified contract)', () => {
  it('treats an authenticated account list as connected and finds the M-Pesa destination', async () => {
    const spec: StubSpec = {
      body: {
        payment_accounts: [
          { id: 'pac_1', display_name: 'Shop Paybill', account_type: 'PAYBILL', environment: 'sandbox' },
          { id: 'pac_2', display_name: 'Other', account_type: 'SEND_MONEY', environment: 'sandbox' },
        ],
      },
    };
    const adapter = new PaymentOSAdapter(CONFIG, stubFetch(spec));
    const health = await adapter.checkHealth({ environment: 'SANDBOX' });
    assert.equal(health.connected, true);
    assert.equal(health.mpesaAccount?.id, 'pac_1');
    assert.equal(health.mpesaAccount?.environment, 'SANDBOX');
    assert.ok(String(spec.seen?.[0]?.url).includes('/api/payment-accounts'));
  });

  it('distinguishes unauthorized from unreachable', async () => {
    const unauthorized = new PaymentOSAdapter(CONFIG, stubFetch({ status: 401, body: { error: 'invalid tenant credentials' } }));
    assert.deepEqual(await unauthorized.checkHealth({}), { connected: false, mpesaAccount: null, failure: 'unauthorized' });
    const unreachable = new PaymentOSAdapter(CONFIG, stubFetch({ status: 500, body: null }));
    assert.deepEqual(await unreachable.checkHealth({}), { connected: false, mpesaAccount: null, failure: 'unreachable' });
  });
});

describe('PaymentOSAdapter.parseCallback (verified webhook contract)', () => {
  const payload = {
    event: 'payment.completed',
    paymentId: 'pay_9',
    applicationId: 'hapos-shop-1',
    amount: 500,
    currency: 'KES',
    reference: 'pay-order-9-1',
    providerReceipt: 'RKTQDM7W6S',
    invoice_id: 'pay-order-9-1',
    status: 'paid',
  };
  const rawBody = JSON.stringify(payload);

  it('accepts correctly signed webhooks (t=,v1= over canonical JSON)', () => {
    const adapter = new PaymentOSAdapter(CONFIG, stubFetch({}));
    const event = adapter.parseCallback(rawBody, { 'x-paymentos-signature': signPaymentOSWebhook(payload, 'whsec-test-secret') });
    assert.equal(event.providerRequestId, 'pay_9');
    assert.equal(event.status, 'SUCCESS');
    assert.equal(event.amount, 500);
    assert.equal(event.providerReference, 'RKTQDM7W6S');
  });

  it('verifies signatures over key-sorted canonical JSON (field order independent)', () => {
    const adapter = new PaymentOSAdapter(CONFIG, stubFetch({}));
    const reordered = JSON.stringify({ status: 'paid', amount: 500, event: 'payment.completed', paymentId: 'pay_9' });
    const event = adapter.parseCallback(
      reordered,
      { 'x-paymentos-signature': signPaymentOSWebhook({ amount: 500, event: 'payment.completed', paymentId: 'pay_9', status: 'paid' }, 'whsec-test-secret') },
    );
    assert.equal(event.providerRequestId, 'pay_9');
  });

  it('rejects forged, missing, stale and malformed callbacks', () => {
    const adapter = new PaymentOSAdapter(CONFIG, stubFetch({}));
    assertGatewayCode(() => adapter.parseCallback(rawBody, { 'x-paymentos-signature': 't=1,v1=deadbeef' }), 'callback-unauthenticated');
    assertGatewayCode(() => adapter.parseCallback(rawBody, {}), 'callback-unauthenticated');
    assertGatewayCode(
      () => adapter.parseCallback('not-json', { 'x-paymentos-signature': signPaymentOSWebhook({ a: 1 }, 'whsec-test-secret') }),
      'gateway-malformed',
    );
    // Wrong secret (e.g. another tenant's webhook secret) must fail.
    assertGatewayCode(
      () => adapter.parseCallback(rawBody, { 'x-paymentos-signature': signPaymentOSWebhook(payload, 'whsec-other-tenant') }),
      'callback-unauthenticated',
    );
  });
});

describe('MockPaymentProvider', () => {
  it('drives the lifecycle explicitly without network', async () => {
    const mock = new MockPaymentProvider({ NODE_ENV: 'test' });
    const initiated = await mock.initiatePayment({
      amount: 1000, currency: 'KES', customerPhone: '+254700000001', tenantId: 't', idempotencyKey: 'k1', callbackUrl: null,
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
      amount: 100, currency: 'KES', customerPhone: '+254700000001', tenantId: 't', idempotencyKey: 'k2', callbackUrl: null,
    });
    mock.failIntent(failed.providerRequestId);
    assert.equal((await mock.verifyPayment(failed.providerRequestId)).status, 'FAILED');
    const expired = await mock.initiatePayment({
      amount: 100, currency: 'KES', customerPhone: '+254700000001', tenantId: 't', idempotencyKey: 'k3', callbackUrl: null,
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
