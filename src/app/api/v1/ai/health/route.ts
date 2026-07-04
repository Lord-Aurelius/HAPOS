import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/server/auth/demo-session';

const { initTools } = require('@/server/ai/ai/initTools');
const { registryHealth } = require('@/server/ai/ai/toolRegistry');
const { resolveProvider, listConfiguredProviders } = require('@/server/ai/ai/providerRegistry');
const env = require('@/server/config/env');

export async function GET() {
  try {
    const session = await getCurrentSession();

    let toolHealth = null;
    let providerStatus = 'disabled';
    let providerName = 'disabled';

    try {
      const health = initTools ? registryHealth() : null;
      toolHealth = health ? { registered: health.registered, total: health.totalCatalogued, missing: health.missingTools } : null;

      const providers = listConfiguredProviders ? listConfiguredProviders() : [];
      providerName = env?.ai?.defaultProvider || 'disabled';
      providerStatus = env?.ai?.enabled ? (providers.some((p: any) => p.active && p.configured) ? 'ready' : 'not_configured') : 'disabled';
    } catch (e: any) {
      providerStatus = 'error';
    }

    return NextResponse.json({
      status: providerStatus === 'disabled' ? 'disabled' : providerStatus === 'error' ? 'error' : 'ok',
      ai: {
        enabled: Boolean(env?.ai?.enabled),
        provider: providerName,
        providerStatus,
      },
      tools: toolHealth,
      session: session ? { authenticated: true, role: session.user.role } : { authenticated: false },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ status: 'error', error: 'Health check failed' }, { status: 500 });
  }
}
