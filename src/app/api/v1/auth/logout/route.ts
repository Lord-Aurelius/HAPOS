import { NextResponse } from 'next/server';

import { signOutSession } from '@/server/auth/demo-session';

export async function POST(request: Request) {
  await signOutSession();
  return NextResponse.redirect(new URL('/login', request.url));
}
