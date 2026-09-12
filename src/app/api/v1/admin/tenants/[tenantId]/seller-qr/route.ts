import QRCode from 'qrcode';
import { NextResponse } from 'next/server';

import { requireSession } from '@/server/auth/demo-session';
import { QrAccessError, checkQrTenantAccess } from '@/server/auth/qr-access';
import { QrWrapError, getQrWrapKey, resolvePersistentQrBearer } from '@/server/crypto/qr-wrap';
import { getSellerCredentialRecordByReference, getTenantById } from '@/server/store';
import { buildSellerQrUrl } from '@/server/config/public-url';

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

function getDownloadHeader(filename: string, shouldDownload: boolean) {
  return `${shouldDownload ? 'attachment' : 'inline'}; filename="${filename}"`;
}

/**
 * Render a seller QR code (admin only, own tenant).
 *
 * The bearer is supplied explicitly as `?bearer=` — shown once at issuance /
 * rotation and never persisted. The payload resolves a transaction-only
 * context (CREATE_ORDER + SUBMIT_ORDER); it is never interchangeable with the
 * attendance or booking QRs (distinct path and credential namespace).
 */
export async function GET(request: Request, context: RouteContext) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  const { tenantId } = await context.params;
  const tenant = await getTenantById(tenantId);

  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found.' }, { status: 404 });
  }

  try {
    checkQrTenantAccess(session, tenant.id);
  } catch (error) {
    if (error instanceof QrAccessError) {
      return NextResponse.json({ error: 'Only admins for this shop can render seller QR codes.' }, { status: 403 });
    }
    throw error;
  }

  const { searchParams } = new URL(request.url);
  const reference = searchParams.get('reference') ?? '';
  if (!reference) {
    return NextResponse.json({ error: 'reference is required.' }, { status: 400 });
  }

  // One-time ceremony bearer wins when supplied; otherwise rebuild the SAME
  // active QR from the sealed copy (persistent printing). Either way the
  // bearer only ever leaves inside this admin-gated QR image.
  let bearer: string;
  try {
    const row = reference ? await getSellerCredentialRecordByReference(reference) : null;
    bearer = resolvePersistentQrBearer({
      row: row ? { tenantId: row.tenantId, sealed: row.bearerWrapped ?? null } : null,
      tenantId: tenant.id,
      isUsable: row?.status === 'ACTIVE',
      explicitBearer: searchParams.get('bearer') || null,
      wrapKey: getQrWrapKey(),
    });
  } catch (error) {
    if (error instanceof QrWrapError && error.code === 'qr-not-found') {
      return NextResponse.json({ error: 'No active seller QR for that reference.' }, { status: 404 });
    }
    if (error instanceof QrWrapError) {
      return NextResponse.json(
        { error: 'Print / Reissue the QR once to enable persistent printing.' },
        { status: 400 },
      );
    }
    throw error;
  }

  const format = searchParams.get('format') === 'png' ? 'png' : 'svg';
  const shouldDownload = searchParams.get('download') === '1';
  const sellerUrl = buildSellerQrUrl(reference, bearer);

  if (format === 'png') {
    const png = await QRCode.toBuffer(sellerUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 960,
      color: {
        dark: '#08161c',
        light: '#FFFFFFFF',
      },
    });

    return new NextResponse(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': getDownloadHeader(`${tenant.slug}-seller-qr.png`, shouldDownload),
        'Cache-Control': 'private, max-age=300',
      },
    });
  }

  const svg = await QRCode.toString(sellerUrl, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    color: {
      dark: '#08161c',
      light: '#FFFFFFFF',
    },
  });

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Content-Disposition': getDownloadHeader(`${tenant.slug}-seller-qr.svg`, shouldDownload),
      'Cache-Control': 'private, max-age=300',
    },
  });
}
