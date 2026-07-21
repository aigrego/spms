import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '@/mcp/server';
import { getSession } from '@/lib/session';

/* MCP endpoint (Phase D) — Streamable HTTP, stateless mode. See docs/MCP.md.
   The SDK's WebStandard transport speaks Web Request/Response directly, so no
   Node IncomingMessage/ServerResponse adapter is needed in the Next.js route
   handler. Each request builds a fresh McpServer + transport pair (stateless
   transports are single-use by design). */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function mcpApiKeys(): string[] {
  return (process.env.MCP_API_KEY ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

/* Bearer key (env MCP_API_KEY, comma-separated) OR a valid browser cookie session. */
async function authorized(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const key = auth.slice(7).trim();
    if (key && mcpApiKeys().includes(key)) return true;
  }
  return (await getSession()) !== null;
}

function unauthorized(): Response {
  return Response.json(
    { ok: false, error: { code: 'UNAUTHORIZED', message: '需要 Bearer MCP_API_KEY 或已登录的浏览器会话' } },
    { status: 401 },
  );
}

async function handle(req: Request): Promise<Response> {
  if (!(await authorized(req))) return unauthorized();
  const server = createMcpServer();
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
  if (!(await authorized(req))) return unauthorized();
  // Stateless mode has no session to attach a standalone SSE stream to —
  // clients only need POST (JSON-RPC over Streamable HTTP).
  return Response.json(
    { ok: false, error: { code: 'NOT_FOUND', message: 'stateless MCP 端点不支持 GET SSE 流，请使用 POST' } },
    { status: 405 },
  );
}
