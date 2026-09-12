import QRCode from 'qrcode';
import { NextResponse } from 'next/server';

import { requireSession } from '@/server/auth/demo-session';
import { QrAccessError, checkQrTenantAccess } from '@/server/auth/qr-access';
import { getTenantById } from '@/server/store';
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
  const token = searchParams.get('token') ?? '';
  const reference = searchParams.get('reference') ?? '';
  if (!token || !reference) {
    return NextResponse.json(
      { error: 'Rotate the terminal to generate a fresh QR code.' },
      { status: 400 },
    );
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
