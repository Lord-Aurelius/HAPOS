import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import type { StoredPassword } from '@/server/store/types';

export function hashPassword(password: string): StoredPassword {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');

  return { salt, hash };
}

export function verifyPassword(password: string, stored: StoredPassword): boolean {
  const derived = scryptSync(password, stored.salt, 64);
  const expected = Buffer.from(stored.hash, 'hex');

  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
