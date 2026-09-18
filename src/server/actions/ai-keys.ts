'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireSession } from '@/server/auth/demo-session';
import { ApiKeyError, listApiKeyMetadata, mintApiKey, revokeApiKey } from '@/server/auth/api-keys';
import { readStore, updateStore } from '@/server/store';

function formString(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

/**
 * Mint an API key from the creator portal (super_admin only). Thin adapter
 * over the canonical api-keys domain: normal scope binds the chosen tenant +
 * user, master scope binds neither. The secret is surfaced once via the
 * redirect URL (same one-time ceremony as seller QR bearers) and never stored.
 */
export async function mintApiKeyAction(formData: FormData) {
  const session = await requireSession(['super_admin']);
  const redirectBase = formString(formData, 'redirectTo') || '/super/connections';

  const scope = formString(formData, 'scope') === 'master' ? 'master' : 'normal';
  const tenantId = scope === 'master' ? null : formString(formData, 'tenantId') || null;
  const userId = scope === 'master' ? null : formString(formData, 'userId') || null;
  const name = formString(formData, 'name');
  const expiresAt = formString(formData, 'expiresAt') || null;

  try {
    const minted = await updateStore((store) =>
      mintApiKey(store as never, {
        scope,
        tenantId,
        userId,
        name,
        createdBy: session.user.id,
        minterRole: session.user.role,
        expiresAt,
      }),
    );
    revalidatePath('/super/connections');
    redirect(
      `${redirectBase}?success=key-minted&showKey=${encodeURIComponent(minted.secret)}&keyId=${minted.record.id}`,
    );
  } catch (error) {
    if (error instanceof ApiKeyError) {
      redirect(`${redirectBase}?error=${error.code === 'forbidden' ? 'key-forbidden' : 'key-invalid'}`);
    }
    throw error;
  }
}

/** Revoke an API key from the creator portal (super_admin only). */
export async function revokeApiKeyAction(formData: FormData) {
  const session = await requireSession(['super_admin']);
  const redirectBase = formString(formData, 'redirectTo') || '/super/connections';
  const id = formString(formData, 'id');
  const scope = formString(formData, 'scope') === 'master' ? 'master' : null;

  if (!id) {
    redirect(`${redirectBase}?error=key-invalid`);
  }

  try {
    const store = await readStore();
    const row = (store.apiKeys ?? []).find((item) => item.id === id) ?? null;
    await updateStore((inner) =>
      revokeApiKey(inner as never, { id, tenantId: row?.tenantId ?? null, scope }),
    );
    revalidatePath('/super/connections');
    redirect(`${redirectBase}?success=key-revoked`);
  } catch (error) {
    if (error instanceof ApiKeyError) {
      redirect(`${redirectBase}?error=${error.code === 'unknown-key' ? 'key-missing' : 'key-forbidden'}`);
    }
    throw error;
  }
}

export async function listApiKeysForPortal() {
  await requireSession(['super_admin']);
  const store = await readStore();
  return listApiKeyMetadata(store as never, { tenantId: null, includeMaster: true });
}
