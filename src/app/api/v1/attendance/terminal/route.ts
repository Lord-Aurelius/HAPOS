import { NextResponse } from 'next/server';

import { resolveTerminalReference } from '@/app/api/v1/attendance/terminal-ops';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const reference = (searchParams.get('reference') ?? '').trim();
  if (!reference) {
    return NextResponse.json({ error: 'reference is required.', code: 'invalid-terminal' }, { status: 400 });
  }
  return resolveTerminalReference(reference);
}
