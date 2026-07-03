import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/server/auth/demo-session';

const { executeTool } = require('@/server/ai/ai/toolRegistry');

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session || !session.tenant) {
    return NextResponse.json({ error: 'Not authenticated or no tenant context' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as { period?: string };
  const period = (body.period || 'this_month').toLowerCase();
  const context = { tenantId: session.tenant.id, userId: session.user.id, role: session.user.role };

  try {
    const [
      revenueResult, expenseResult, profitResult, customerResult,
      healthResult, riskResult, oppResult, forecastResult, branchResult
    ] = await Promise.all([
      runTool('revenueSummary', context, { period }),
      runTool('expenseAnalysis', context, { period }),
      runTool('profitAnalysis', context, { period }),
      runTool('customerIntelligence', context, { period }),
      runTool('businessHealthScore', context, { period }),
      runTool('riskDetection', context, { period }),
      runTool('opportunityDetection', context, { period }),
      runTool('revenueForecast', context, { period: 'next_month' }),
      runTool('branchPerformance', context, { period }),
    ]);

    return NextResponse.json({
      status: 'ok',
      period,
      revenue: revenueResult?.data || revenueResult,
      expenses: expenseResult?.data || expenseResult,
      profitability: profitResult?.data || profitResult,
      customers: customerResult?.data || customerResult,
      healthScore: healthResult?.data || healthResult,
      risks: riskResult?.data || riskResult,
      opportunities: oppResult?.data || oppResult,
      forecast: forecastResult?.data || forecastResult,
      branches: branchResult?.data || branchResult,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Dashboard data fetch failed', status: 'error' },
      { status: 500 },
    );
  }
}

async function runTool(toolId: string, context: any, args: any) {
  try {
    return await executeTool({ role: context.role, toolId, context, args });
  } catch {
    return { success: false, error: `${toolId} unavailable` };
  }
}
