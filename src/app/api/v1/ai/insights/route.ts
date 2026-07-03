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
        message: `Analyse business performance for ${body.period || 'this month'}. Provide revenue, expense, profit, customer, and service insights.`,
        provider: null,
        conversationId: `insights_${session.tenant.id}`,
      },
    );

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Insight generation failed' },
      { status: 500 },
    );
  }
}
