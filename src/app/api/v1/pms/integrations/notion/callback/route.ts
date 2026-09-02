import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { notionConnections } from '@/db/schema';
import { requirePerm } from '@/lib/permissions';
import { requireActor } from '@/server/http';
import { NOTION_STATE_COOKIE, exchangeCode, notionConfigured } from '@/server/notion';

function notionResult(req: NextRequest, result: 'connected' | 'failed') {
  const url = new URL('/integrations', req.url);
  url.searchParams.set('notion', result);
  const res = NextResponse.redirect(url, 302);
  res.cookies.delete(NOTION_STATE_COOKIE);
  return res;
}

/* GET /api/v1/pms/integrations/notion/callback?code=...&state=...
   Verifies the nonce cookie set by /authorize, exchanges the code for an
   access token (Basic auth) and upserts the company's notion_connections row
   (the token stays server-side; it is never served back out). Any failure →
   302 /integrations?notion=failed. */
export async function GET(req: NextRequest) {
  if (!notionConfigured()) return notionResult(req, 'failed');
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state') ?? '';
  const cookieNonce = req.cookies.get(NOTION_STATE_COOKIE)?.value;
  if (!code || !cookieNonce || cookieNonce !== state) return notionResult(req, 'failed');

  try {
    const actor = await requireActor(); // session + current-company resolution
    await requirePerm(actor, 'notion', 'write');
    const tok = await exchangeCode(code, req.nextUrl.origin);

    const [existing] = await db
      .select({ id: notionConnections.id })
      .from(notionConnections)
      .where(eq(notionConnections.companyId, actor.companyId))
      .limit(1);
    if (existing) {
      await db
        .update(notionConnections)
        .set({
          workspaceId: tok.workspaceId ?? null,
          workspaceName: tok.workspaceName ?? null,
          botId: tok.botId ?? null,
          accessToken: tok.accessToken,
          updatedAt: new Date(),
        })
        .where(eq(notionConnections.id, existing.id));
    } else {
      await db.insert(notionConnections).values({
        id: crypto.randomUUID(),
        companyId: actor.companyId,
        workspaceId: tok.workspaceId ?? null,
        workspaceName: tok.workspaceName ?? null,
        botId: tok.botId ?? null,
        accessToken: tok.accessToken,
        createdById: actor.userId,
      });
    }
    return notionResult(req, 'connected');
  } catch (e) {
    console.error('[notion] callback failed:', e);
    return notionResult(req, 'failed');
  }
}
