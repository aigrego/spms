import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer, type McpKeyContext } from '@/mcp/server';
import { db } from '@/db';
import { mcpApiKeys } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { requireActor } from '@/server/http';

/* MCP endpoint (Phase D) — Streamable HTTP, stateless mode. See docs/MCP.md.
   The SDK's WebStandard transport speaks Web Request/Response directly, so no
   Node IncomingMessage/ServerResponse adapter is needed in the Next.js route
   handler. Each request builds a fresh McpServer + transport pair (stateless
   transports are single-use by design).

   Auth (multi-company sandbox):
     1. `Authorization: Bearer <key>` → sha256 hex → mcp_api_keys.keyHash with
        revokedAt IS NULL. A hit yields the key's company scope (NULL companyId
        = platform-level key).
     2. Miss → fall back to the env MCP_API_KEY list (comma-separated), treated
        as platform-level (legacy/dev compatibility).
     3. Otherwise a valid browser cookie session is accepted (debugging); the
        actor is the session user's current company via requireActor(). */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function envMcpApiKeys(): string[] {
  return (process.env.MCP_API_KEY ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

async function authenticate(req: Request): Promise<McpKeyContext | null> {
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const key = auth.slice(7).trim();
    if (key) {
      const keyHash = createHash('sha256').update(key).digest('hex');
      const [row] = await db
        .select({ id: mcpApiKeys.id, companyId: mcpApiKeys.companyId })
        .from(mcpApiKeys)
        .where(and(eq(mcpApiKeys.keyHash, keyHash), isNull(mcpApiKeys.revokedAt)))
        .limit(1);
      if (row) return { companyId: row.companyId, source: 'db' };
      if (envMcpApiKeys().includes(key)) return { companyId: null, source: 'env' };
      // An explicitly presented but unknown key must not fall through to the
      // cookie session — that would mask typos and let a revoked key keep
      // working from a logged-in browser.
      return null;
    }
  }
  try {
    const sessionActor = await requireActor();
    return { companyId: sessionActor.companyId, source: 'session', sessionActor };
  } catch (e) {
    if (e instanceof ApiException) return null; // UNAUTHORIZED / NO_COMPANY → 401 below
    throw e;
  }
}

function unauthorized(): Response {
  return Response.json(
    { ok: false, error: { code: 'UNAUTHORIZED', message: '需要有效的 MCP API Key（Bearer）或已登录的浏览器会话' } },
    { status: 401 },
  );
}

async function handle(req: Request): Promise<Response> {
  const keyContext = await authenticate(req);
  if (!keyContext) return unauthorized();
  const server = createMcpServer(keyContext);
  // JSON response mode: handleRequest resolves only after all responses are
  // sent, so closing the server in `finally` is safe. (Default SSE mode would
  // return the Response before the events are written, and an early close()
  // would truncate the stream.)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // server.close() also closes the transport; POST response streams are
    // already fully written by handleRequest at this point.
    await server.close().catch(() => undefined);
  }
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}

export async function DELETE(req: Request): Promise<Response> {
  return handle(req);
}

export async function GET(req: Request): Promise<Response> {
  if (!(await authenticate(req))) return unauthorized();
  // Stateless mode has no session to attach a standalone SSE stream to —
  // clients only need POST (JSON-RPC over Streamable HTTP).
  return Response.json(
    { ok: false, error: { code: 'NOT_FOUND', message: 'stateless MCP 端点不支持 GET SSE 流，请使用 POST' } },
    { status: 405 },
  );
}
