import { NextResponse } from 'next/server';

import { readImageAsset } from '@/server/assets';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await params;
  const asset = await readImageAsset(assetId);

  if (!asset) {
    return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(asset.bytes), {
    headers: {
      'Content-Type': asset.mimeType,
      'Content-Length': String(asset.bytes.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
