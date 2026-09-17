import { getCurrentSession } from '@/server/auth/demo-session';
import { listAiEvents, type AiEventRecord } from '@/server/aegis/events';
import { authenticateRequest, requirePrincipal, shopContextForPrincipal } from '@/server/aegis/principal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * HAPOS event stream (GATE 16/22) as Server-Sent Events over the existing
 * Next.js deployment (no separate socket server, no deployment change).
 * Replays persisted events from the cursor, then tails the log; clients
 * reconnect with the last seen id, so delivery resumes without loss or
 * duplicates. Tenant/shop scope is enforced before streaming starts.
 */
export async function GET(request: Request) {
  const session = await getCurrentSession();
  let found;
  try {
    found = await authenticateRequest(
      request,
      session ? { user: { id: session.user.id, role: session.user.role }, tenant: session.tenant ? { id: session.tenant.id } : null } : null,
    );
  } catch {
    return new Response(JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication failed.', retryable: false } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let principal;
  try {
    principal = requirePrincipal(found);
  } catch {
    return new Response(JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication is required.', retryable: false } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const shopParam = url.searchParams.get('shop') ?? request.headers.get('x-hapos-shop') ?? undefined;
  const cursor = url.searchParams.get('cursor') ?? undefined;

  let tenantId: string;
  try {
    tenantId = (await shopContextForPrincipal(principal, shopParam)).tenantId;
  } catch (error) {
    const known = error as { status?: number; message?: string };
    return new Response(JSON.stringify({ ok: false, error: { code: 'WRONG_SHOP', message: known.message ?? 'Invalid shop scope.', retryable: false } }), {
      status: known.status ?? 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let lastId = cursor ?? null;
  let stopped = false;
  request.signal.addEventListener('abort', () => {
    stopped = true;
  });

  const encode = (event: AiEventRecord): string => `event: hapos\ndata: ${JSON.stringify(event)}\n\n`;

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (chunk: string) => {
        if (!stopped) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
      };
      try {
        const replay = await listAiEvents(tenantId, { cursor: lastId, limit: 100 });
        for (const event of replay.events) {
          enqueue(encode(event));
          lastId = event.id;
        }
        // Tail the persisted log until the client disconnects.
        while (!stopped) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          if (stopped) {
            break;
          }
          const tail = await listAiEvents(tenantId, { cursor: lastId, limit: 100 });
          for (const event of tail.events) {
            enqueue(encode(event));
            lastId = event.id;
          }
          enqueue(': keepalive\n\n');
        }
      } catch {
        enqueue(`event: error\ndata: ${JSON.stringify({ code: 'TEMPORARY_FAILURE', message: 'Event stream interrupted. Reconnect with the last seen id.', retryable: true })}\n\n`);
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      stopped = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
