import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  QrWrapError,
  getQrWrapKey,
  openBearer,
  parseQrWrapKey,
  resolvePersistentQrBearer,
  resolveRenderBearer,
  sealBearer,
} from '../src/server/crypto/qr-wrap.ts';

const KEY_HEX = 'a1'.repeat(32);
const OTHER_KEY_HEX = 'b2'.repeat(32);
const BEARER = 'c3'.repeat(32);

function assertWrapCode(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (error: unknown) => error instanceof QrWrapError && error.code === code,
    `expected QrWrapError ${code}`,
  );
}

describe('parseQrWrapKey / getQrWrapKey', () => {
  it('accepts 64-hex keys and rejects everything else', () => {
    assert.equal(parseQrWrapKey(KEY_HEX).length, 32);
    for (const bad of ['', 'short', 'z'.repeat(64), 'a1'.repeat(31), 'a1'.repeat(33), null, undefined, 42]) {
      assertWrapCode(() => parseQrWrapKey(bad), 'invalid-key');
    }
  });

  it('resolves from the environment, degrading to null (reissue-only)', () => {
    assert.deepEqual(getQrWrapKey({}), null);
    assert.deepEqual(getQrWrapKey({ QR_WRAP_KEY: 'nope' }), null);
    assert.equal(getQrWrapKey({ QR_WRAP_KEY: KEY_HEX })?.length, 32);
  });
});

describe('sealBearer / openBearer', () => {
  it('round-trips and randomizes the envelope', () => {
    const key = parseQrWrapKey(KEY_HEX);
    const first = sealBearer(BEARER, key);
    const second = sealBearer(BEARER, key);
    assert.ok(first.startsWith('v1.'));
    assert.notEqual(first, second);
    assert.equal(openBearer(first, key), BEARER);
    assert.equal(openBearer(second, key), BEARER);
  });

  it('fails closed on wrong keys, tampering and version drift', () => {
    const key = parseQrWrapKey(KEY_HEX);
    const sealed = sealBearer(BEARER, key);
    assertWrapCode(() => openBearer(sealed, parseQrWrapKey(OTHER_KEY_HEX)), 'needs-reissue');
    const tampered = sealed.slice(0, -4) + 'AAAA';
    assertWrapCode(() => openBearer(tampered, key), 'needs-reissue');
    assertWrapCode(() => openBearer('v9.aaaa.bbbb', key), 'needs-reissue');
    assertWrapCode(() => openBearer('garbage', key), 'needs-reissue');
    assertWrapCode(() => openBearer(null, key), 'needs-reissue');
    assertWrapCode(() => openBearer(sealed, null), 'needs-reissue');
  });
});

describe('resolveRenderBearer', () => {
  it('passes explicit ceremony bearers through and opens sealed copies', () => {
    const key = parseQrWrapKey(KEY_HEX);
    assert.equal(resolveRenderBearer({ kind: 'explicit', bearer: BEARER }), BEARER);
    assert.equal(
      resolveRenderBearer({ kind: 'persistent', sealed: sealBearer(BEARER, key), wrapKey: key }),
      BEARER,
    );
    assertWrapCode(() => resolveRenderBearer({ kind: 'explicit', bearer: '' }), 'needs-reissue');
    assertWrapCode(() => resolveRenderBearer({ kind: 'persistent', sealed: null, wrapKey: key }), 'needs-reissue');
    assertWrapCode(() => resolveRenderBearer({ kind: 'persistent', sealed: sealBearer(BEARER, key), wrapKey: null }), 'needs-reissue');
  });
});

describe('resolvePersistentQrBearer (panel re-render contract)', () => {
  const key = parseQrWrapKey(KEY_HEX);
  const row = { tenantId: 'tenant-a', sealed: '' as string | null };

  it('renders the SAME active credential on repeat visits', () => {
    const sealed = sealBearer(BEARER, key);
    const first = resolvePersistentQrBearer({
      row: { ...row, sealed }, tenantId: 'tenant-a', isUsable: true, explicitBearer: null, wrapKey: key,
    });
    const second = resolvePersistentQrBearer({
      row: { ...row, sealed }, tenantId: 'tenant-a', isUsable: true, explicitBearer: null, wrapKey: key,
    });
    assert.equal(first, BEARER);
    assert.equal(second, BEARER);
  });

  it('prefers the one-time ceremony bearer and isolates tenants', () => {
    assert.equal(
      resolvePersistentQrBearer({
        row, tenantId: 'tenant-a', isUsable: true, explicitBearer: BEARER, wrapKey: null,
      }),
      BEARER,
    );
    assertWrapCode(
      () => resolvePersistentQrBearer({
        row, tenantId: 'tenant-b', isUsable: true, explicitBearer: null, wrapKey: key,
      }),
      'qr-not-found',
    );
    assertWrapCode(
      () => resolvePersistentQrBearer({ row: null, tenantId: 'tenant-a', isUsable: true, explicitBearer: null, wrapKey: key }),
      'qr-not-found',
    );
  });

  it('revoked rows and missing sealed copies fail safely', () => {
    assertWrapCode(
      () => resolvePersistentQrBearer({
        row, tenantId: 'tenant-a', isUsable: false, explicitBearer: null, wrapKey: key,
      }),
      'qr-not-found',
    );
    assertWrapCode(
      () => resolvePersistentQrBearer({
        row: { ...row, sealed: null }, tenantId: 'tenant-a', isUsable: true, explicitBearer: null, wrapKey: key,
      }),
      'needs-reissue',
    );
  });
});
