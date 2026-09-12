import QRCode from 'qrcode';
import { NextResponse } from 'next/server';

import { requireSession } from '@/server/auth/demo-session';
import { getTenantById } from '@/server/store';
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

  if (session.user.role !== 'super_admin' && session.tenant?.id !== tenant.id) {
    return NextResponse.json({ error: 'Only admins for this shop can render seller QR codes.' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const bearer = searchParams.get('bearer') ?? '';
  const reference = searchParams.get('reference') ?? '';
  if (!bearer || !reference) {
    return NextResponse.json(
      { error: 'Issue or rotate the seller credential to generate a fresh QR code.' },
      { status: 400 },
    );
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
