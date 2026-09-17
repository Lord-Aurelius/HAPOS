import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/server/auth/demo-session';
import { invokeCapability } from '@/server/aegis/pipeline';
import { authenticateRequest } from '@/server/aegis/principal';

const { getToolHealth, getToolSchemas } = require('@/server/ai/ai/aiToolRouter');
const { isToolAllowed } = require('@/server/ai/ai/aiTools');

/**
 * Legacy tool surface, unified onto the authoritative pipeline (GATE 17).
 * Discovery advertises only what the caller's role may execute (GATE 19);
 * execution is audited and returns machine-readable codes alongside the
 * historical envelope fields.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const role = session.user.role;
    const health = getToolHealth ? getToolHealth() : null;
    const schemas = (getToolSchemas ? getToolSchemas() : []).filter(
      (schema: { function?: { name?: string } }) => schema?.function?.name && isToolAllowed(role, schema.function.name),
    );

    return NextResponse.json({ health, schemas });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to get tool info' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session || !session.tenant) {
    return NextResponse.json({ success: false, code: 'UNAUTHORIZED', error: 'Not authenticated or no tenant context' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    toolId?: unknown;
    args?: Record<string, unknown>;
    confirm?: unknown;
  };

  if (!body.toolId) {
    return NextResponse.json({ success: false, code: 'INVALID_ARGUMENT', error: 'toolId is required' }, { status: 400 });
  }

  let principal;
  try {
    principal = await authenticateRequest(request, {
      user: { id: session.user.id, role: session.user.role },
      tenant: { id: session.tenant.id },
    });
  } catch (error: any) {
    const known = error as { status?: number; toBody?: () => { message?: string }; message?: string };
    return NextResponse.json(
      { success: false, code: 'UNAUTHORIZED', error: known.toBody ? known.toBody().message ?? 'Authentication failed.' : (known.message ?? 'Authentication failed.') },
      { status: known.status ?? 401 },
    );
  }

  const result = await invokeCapability({
    principal,
    capability: body.toolId,
    args: body.args || {},
    confirm: body.confirm === true,
  });

  if (result.ok) {
    return NextResponse.json({ success: true, code: 'OK', toolId: result.capability, result: result.data });
  }
  const status = result.error.code === 'UNAUTHORIZED' ? 401
    : result.error.code === 'FORBIDDEN' || result.error.code === 'WRONG_TENANT' || result.error.code === 'WRONG_SHOP' ? 403
    : result.error.code === 'NOT_FOUND' ? 404
    : result.error.code === 'INVALID_ARGUMENT' ? 400
    : result.error.code === 'CONFLICT' || result.error.code === 'ALREADY_COMPLETED' ? 409
    : result.error.code === 'CONFIRMATION_REQUIRED' ? 428
    : result.error.code === 'TEMPORARY_FAILURE' ? 503
    : 500;
  return NextResponse.json(
    { success: false, code: result.error.code, toolId: result.capability, error: result.error.message, retryable: result.error.retryable },
    { status },
  );
}
