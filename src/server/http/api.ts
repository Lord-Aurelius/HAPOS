import { NextResponse } from 'next/server';

import { getRuntimeModeHeader } from '@/server/runtime';

export function apiOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      'x-runtime-mode': getRuntimeModeHeader(),
      ...(init?.headers ?? {}),
    },
  });
}

export function apiCreated<T>(data: T) {
  return apiOk(data, { status: 201 });
}

export function apiAccepted<T>(data: T) {
  return apiOk(data, { status: 202 });
}

export function apiNoContent() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'x-runtime-mode': getRuntimeModeHeader(),
    },
  });
}

export function apiBadRequest(message: string, status = 400) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        'x-runtime-mode': getRuntimeModeHeader(),
      },
    },
  );
}
