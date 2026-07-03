import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/server/auth/demo-session';

const { getToolHealth, getToolSchemas, executeToolCall } = require('@/server/ai/ai/aiToolRouter');

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const health = getToolHealth ? getToolHealth() : null;
  const schemas = getToolSchemas ? getToolSchemas() : [];

  return NextResponse.json({ health, schemas });
}

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session || !session.tenant) {
    return NextResponse.json({ error: 'Not authenticated or no tenant context' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as {
    toolId?: string;
    args?: Record<string, unknown>;
  };

  if (!body.toolId) {
    return NextResponse.json({ error: 'toolId is required' }, { status: 400 });
  }

  const authContext = { userId: session.user.id, tenantId: session.tenant.id, role: session.user.role };

  try {
    const result = await executeToolCall(authContext, { toolId: body.toolId, args: body.args || {} });
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Tool execution failed' }, { status: 500 });
  }
}
