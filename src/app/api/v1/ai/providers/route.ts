import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/server/auth/demo-session';

const { resolveProvider, listConfiguredProviders } = require('@/server/ai/ai/providerRegistry');
const env = require('@/server/config/env');

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const providers = listConfiguredProviders ? listConfiguredProviders() : [];
    const defaultProvider = env?.ai?.defaultProvider || 'disabled';

    return NextResponse.json({
      defaultProvider,
      enabled: Boolean(env?.ai?.enabled),
      providers: providers.map((p: any) => ({
        name: p.name,
        configured: p.configured,
        active: p.name === defaultProvider,
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to list providers' }, { status: 500 });
  }
}
