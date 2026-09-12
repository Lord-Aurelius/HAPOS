import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { shopNav, shopNavSections } from '../src/lib/nav.ts';

function visibleHrefs(role: string) {
  return shopNav.filter((item) => item.roles.includes(role as never)).map((item) => item.href);
}

describe('shop-admin navigation', () => {
  it('reaches Attendance, Orders and Seller through normal navigation data', () => {
    const hrefs = visibleHrefs('shop_admin');
    assert.ok(hrefs.includes('/app/attendance'));
    assert.ok(hrefs.includes('/app/orders'));
    assert.ok(hrefs.includes('/app/seller'));
  });
});

describe('staff navigation boundaries', () => {
  it('reaches Orders and Seller but never attendance management', () => {
    const hrefs = visibleHrefs('staff');
    assert.ok(hrefs.includes('/app/orders'));
    assert.ok(hrefs.includes('/app/seller'));
    assert.ok(!hrefs.includes('/app/attendance'));
    assert.ok(!hrefs.includes('/app/settings/staff'));
  });
});

describe('sidebar section coverage (regression lock)', () => {
  it('renders every shopNav link in exactly one section', () => {
    const sectioned = shopNavSections.flatMap((section) => section.paths);
    for (const item of shopNav) {
      const occurrences = sectioned.filter((href) => href === item.href).length;
      assert.equal(occurrences, 1, `${item.href} appears in ${occurrences} sections (must be exactly 1)`);
    }
  });
});
