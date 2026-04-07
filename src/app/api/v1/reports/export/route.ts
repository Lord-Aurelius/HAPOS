import { NextResponse } from 'next/server';

import { requireSession } from '@/server/auth/demo-session';
import {
  buildPlatformExportCsv,
  buildPlatformExportDocument,
  buildTenantExportCsv,
  buildTenantExportDocument,
} from '@/server/services/admin-tools';

export async function GET(request: Request) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') === 'csv' ? 'csv' : 'json';
  const scope = searchParams.get('scope') === 'platform' ? 'platform' : 'tenant';
  const requestedTenantId = searchParams.get('tenantId');

  if (scope === 'platform') {
    if (session.user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Only super admin can export platform data.' }, { status: 403 });
    }

    if (format === 'csv') {
      const csv = await buildPlatformExportCsv();
      return new NextResponse(csv.content, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${csv.filename}"`,
        },
      });
    }

    const document = await buildPlatformExportDocument();
    return NextResponse.json(document, {
      headers: {
        'Content-Disposition': `attachment; filename="hapos-platform-overview-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  }

  const tenantId = session.user.role === 'super_admin' ? requestedTenantId : session.tenant?.id;
  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant export requires a tenant id.' }, { status: 400 });
  }

  if (format === 'csv') {
    const csv = await buildTenantExportCsv(tenantId);
    if (!csv) {
      return NextResponse.json({ error: 'Tenant not found.' }, { status: 404 });
    }

    return new NextResponse(csv.content, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${csv.filename}"`,
      },
    });
  }

  const document = await buildTenantExportDocument(tenantId);
  if (!document) {
    return NextResponse.json({ error: 'Tenant not found.' }, { status: 404 });
  }

  return NextResponse.json(document, {
    headers: {
      'Content-Disposition': `attachment; filename="hapos-tenant-export-${tenantId}.json"`,
    },
  });
}
