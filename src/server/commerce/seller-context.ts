/**
 * Seller QR store resolution (server-only).
 *
 * IMPORTANT: this module must NOT carry a `'use server'` directive. Next.js
 * requires every export of a Server Actions module to be an async function,
 * so the synchronous repository helpers here live separately from
 * `@/server/actions/seller` (async actions only). Importing this module from
 * Server Components and Server Actions is safe.
 *
 * Context: credential issuance/management writes the JSON runtime store
 * (updateStore). Verification + orders go through getCommerceRepository(),
 * which is currently the file adapter in every runtime (see
 * repository-select); the SQL branch below is a safety net that only engages
 * if the SQL adapter is ever re-enabled, so previously printed QRs keep
 * scanning either way. Fail-closed on revoked/expired.
 */

import { SellerError } from '@/server/commerce/seller';
import { FileCommerceRepository } from '@/server/commerce/file-repository';
import { getCommerceRepository } from '@/server/commerce/repository-select';
import type { CommerceRepository } from '@/server/commerce/repository';

let fileSellerRepository: FileCommerceRepository | null = null;

export function getFileSellerRepository(): FileCommerceRepository {
  if (!fileSellerRepository) {
    fileSellerRepository = new FileCommerceRepository();
  }
  return fileSellerRepository;
}

function orderedSellerRepositories(): CommerceRepository[] {
  try {
    const primary = getCommerceRepository();
    if (primary.backend !== 'file') {
      return [primary, getFileSellerRepository()];
    }
    return [primary];
  } catch {
    return [getFileSellerRepository()];
  }
}

/** Repository for follow-up reads/writes once a QR context resolved on `backend`. */
export function getSellerCommerceRepository(backend: 'sql' | 'file'): CommerceRepository {
  if (backend === 'file') {
    return getFileSellerRepository();
  }
  try {
    const primary = getCommerceRepository();
    if (primary.backend === 'sql') {
      return primary;
    }
  } catch {
    /* fall through to the file adapter below */
  }
  return getFileSellerRepository();
}

export async function verifySellerCredentialWithFallback(reference: string, bearer: string) {
  const repos = orderedSellerRepositories();
  let notFound: unknown = null;
  for (const repo of repos) {
    let tenantId: string | null = null;
    try {
      tenantId = await repo.resolveSellerCredentialTenant(reference.trim());
    } catch {
      continue;
    }
    if (!tenantId) {
      continue;
    }
    try {
      const context = await repo.verifySellerCredential(tenantId, reference, bearer);
      return { context, repo, tenantId };
    } catch (error) {
      if (
        error instanceof SellerError &&
        (error.code === 'credential-revoked' ||
          error.code === 'credential-expired' ||
          error.code === 'inactive-seller' ||
          error.code === 'forbidden-operation')
      ) {
        throw error;
      }
      if (error instanceof SellerError && (error.code === 'invalid-reference' || error.code === 'invalid-bearer')) {
        notFound = error;
        continue;
      }
      throw error;
    }
  }
  if (notFound) {
    throw notFound;
  }
  throw new SellerError('invalid-reference', 'This seller QR code is not recognized.');
}
