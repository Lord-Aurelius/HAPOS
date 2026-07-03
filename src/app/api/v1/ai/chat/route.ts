import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/server/auth/demo-session';

const { handleAiRequest } = require('@/server/ai/ai/aiService');

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as {
    message?: string;
    endpoint?: string;
    provider?: string;
    conversationId?: string;
    maxSteps?: number;
  };

  if (!body.message) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  }

  const authContext = {
    userId: session.user.id,
    tenantId: session.tenant?.id || null,
    role: session.user.role,
  };

  try {
    const result = await handleAiRequest(
      authContext,
      body.endpoint || 'chat',
      {
        message: body.message,
        provider: body.provider || null,
        conversationId: body.conversationId || `session_${session.user.id}`,
        maxSteps: body.maxSteps || 10,
      },
    );

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'AI request failed' },
      { status: 500 },
    );
  }
}
