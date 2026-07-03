import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/server/auth/demo-session';

const { handleAiRequest } = require('@/server/ai/ai/aiService');

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session || !session.tenant) {
    return NextResponse.json({ error: 'Not authenticated or no tenant context' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as { period?: string; type?: string };

  try {
    const forecastType = body.type || 'revenue';
    const forecastMessage = forecastType === 'expense'
      ? `Generate an expense forecast for ${body.period || 'next month'} based on historical spending patterns.`
      : forecastType === 'demand'
        ? `Forecast demand for services for ${body.period || 'next month'} based on historical booking data.`
        : `Generate a revenue forecast for ${body.period || 'next month'} based on historical trends.`;

    const result = await handleAiRequest(
      { userId: session.user.id, tenantId: session.tenant.id, role: session.user.role },
      'analyze',
      {
        message: forecastMessage,
        provider: null,
        conversationId: `forecast_${session.tenant.id}`,
      },
    );

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forecast generation failed' },
      { status: 500 },
    );
  }
}
