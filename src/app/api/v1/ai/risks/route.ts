import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/server/auth/demo-session';

const { handleAiRequest } = require('@/server/ai/ai/aiService');

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session || !session.tenant) {
    return NextResponse.json({ error: 'Not authenticated or no tenant context' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as { period?: string };

  try {
    const result = await handleAiRequest(
      { userId: session.user.id, tenantId: session.tenant.id, role: session.user.role },
      'analyze',
      {
        message: `Detect business risks for ${body.period || 'this month'}. Check for revenue decline, expense spikes, falling profits, reduced customer activity, and cash flow issues.`,
        provider: null,
        conversationId: `risks_${session.tenant.id}`,
      },
    );

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Risk detection failed' },
      { status: 500 },
    );
  }
}
