import QRCode from 'qrcode';
import { NextResponse } from 'next/server';

import { requireSession } from '@/server/auth/demo-session';
import { QrAccessError, checkQrTenantAccess } from '@/server/auth/qr-access';
import { QrWrapError, getQrWrapKey, resolvePersistentQrBearer } from '@/server/crypto/qr-wrap';
import { getAttendanceTerminalRecordByReference, getTenantById } from '@/server/store';
import { buildAttendanceTerminalUrl } from '@/server/config/public-url';

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

function getDownloadHeader(filename: string, shouldDownload: boolean) {
  return `${shouldDownload ? 'attachment' : 'inline'}; filename="${filename}"`;
}

/**
 * Render the attendance terminal QR (admin only, own tenant).
 *
 * The bearer token is supplied explicitly as `?token=` — it is shown once at
 * rotation time and never persisted. The route verifies the admin session and
 * tenant scope before rendering, and the QR payload is never interchangeable
 * with the customer booking QR (different path and bearer).
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
      return NextResponse.json({ error: 'Only admins for this shop can render its attendance QR.' }, { status: 403 });
    }
    throw error;
  }

  const { searchParams } = new URL(request.url);
  const reference = searchParams.get('reference') ?? '';
  if (!reference) {
    return NextResponse.json({ error: 'reference is required.' }, { status: 400 });
  }

  // One-time ceremony token wins when supplied; otherwise rebuild the SAME
  // active QR from the sealed copy (persistent printing).
  let token: string;
  try {
    const row = await getAttendanceTerminalRecordByReference(reference);
    token = resolvePersistentQrBearer({
      row: row ? { tenantId: row.tenantId, sealed: row.tokenWrapped ?? null } : null,
      tenantId: tenant.id,
      isUsable: Boolean(row && row.isActive && !row.revokedAt),
      explicitBearer: searchParams.get('token') || null,
      wrapKey: getQrWrapKey(),
    });
  } catch (error) {
    if (error instanceof QrWrapError && error.code === 'qr-not-found') {
      return NextResponse.json({ error: 'No active attendance QR for that reference.' }, { status: 404 });
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
  const terminalUrl = buildAttendanceTerminalUrl(reference, token);

  if (format === 'png') {
    const png = await QRCode.toBuffer(terminalUrl, {
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
        'Content-Disposition': getDownloadHeader(`${tenant.slug}-attendance-qr.png`, shouldDownload),
        'Cache-Control': 'private, max-age=300',
      },
    });
  }

  const svg = await QRCode.toString(terminalUrl, {
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
      'Content-Disposition': getDownloadHeader(`${tenant.slug}-attendance-qr.svg`, shouldDownload),
      'Cache-Control': 'private, max-age=300',
    },
  });
}
