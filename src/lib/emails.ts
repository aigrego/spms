import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { userEmails } from '@/db/schema';
import { ApiException } from '@/lib/envelope';

/* User emails (user_emails) — 一个用户可拥有多个邮箱:一个主邮箱
   (is_primary,部分唯一索引保证) + 至多 MAX_BACKUPS 个备用邮箱。邮箱全表
   唯一,即"一个邮箱只属于一个用户"(账号合并不支持)。

   verified 只能由 Lark/飞书 OAuth 回调经 upsertVerifiedEmail 写入(无 SMTP,
   IdP 是唯一验证来源);只有 verified 邮箱可用于认领外部邀请/授予席位
   (identity.claimExternalInvites),自填邮箱仅作展示、登录标识与 Notion
   指派人匹配。 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_BACKUP_EMAILS = 5;

export type UserEmailRow = typeof userEmails.$inferSelect;

/* trim + lowercase;非法格式抛 VALIDATION_FAILED。 */
export function normalizeEmail(raw: string | null | undefined): string {
  const email = raw?.trim().toLowerCase() ?? '';
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    throw new ApiException('VALIDATION_FAILED', '邮箱格式不正确');
  }
  return email;
}

export async function emailsOf(userId: string): Promise<UserEmailRow[]> {
  return db
    .select()
    .from(userEmails)
    .where(eq(userEmails.userId, userId))
    .orderBy(desc(userEmails.isPrimary), asc(userEmails.createdAt));
}

export async function primaryEmailOf(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: userEmails.email })
    .from(userEmails)
    .where(and(eq(userEmails.userId, userId), eq(userEmails.isPrimary, true)))
    .limit(1);
  return row?.email ?? null;
}

/* 任一邮箱(主/备,大小写不敏感)→ 所属用户 id;未命中 → null。 */
export async function findUserByEmail(raw: string): Promise<string | null> {
  const email = raw.trim().toLowerCase();
  if (!email) return null;
  const [row] = await db
    .select({ userId: userEmails.userId })
    .from(userEmails)
    .where(sql`lower(${userEmails.email}) = ${email}`)
    .limit(1);
  return row?.userId ?? null;
}

/* 批量:一组用户 id → 各自的主邮箱(资源池/席位列表展示用)。 */
export async function primaryEmailsFor(userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!userIds.length) return map;
  const rows = await db
    .select({ userId: userEmails.userId, email: userEmails.email })
    .from(userEmails)
    .where(and(inArray(userEmails.userId, userIds), eq(userEmails.isPrimary, true)));
  for (const r of rows) map.set(r.userId, r.email);
  return map;
}

async function emailTaken(email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: userEmails.id })
    .from(userEmails)
    .where(sql`lower(${userEmails.email}) = ${email}`)
    .limit(1);
  return !!row;
}

/* 添加邮箱。默认备用;isPrimary 时若已有主邮箱则先降级它。 */
export async function addEmail(
  userId: string,
  raw: string,
  opts: { isPrimary?: boolean; verified?: boolean } = {},
): Promise<UserEmailRow> {
  const email = normalizeEmail(raw);
  if (await emailTaken(email)) throw new ApiException('CONFLICT', '该邮箱已被使用');
  const existing = await emailsOf(userId);
  const hasPrimary = existing.some((e) => e.isPrimary);
  const isPrimary = opts.isPrimary ?? !hasPrimary; // 第一个邮箱自动成为主邮箱
  if (!isPrimary && existing.filter((e) => !e.isPrimary).length >= MAX_BACKUP_EMAILS) {
    throw new ApiException('VALIDATION_FAILED', `备用邮箱最多 ${MAX_BACKUP_EMAILS} 个`);
  }
  if (isPrimary && hasPrimary) {
    await db.update(userEmails).set({ isPrimary: false }).where(and(eq(userEmails.userId, userId), eq(userEmails.isPrimary, true)));
  }
  const id = crypto.randomUUID();
  await db.insert(userEmails).values({ id, userId, email, isPrimary, verified: opts.verified ?? false });
  const [row] = await db.select().from(userEmails).where(eq(userEmails.id, id)).limit(1);
  return row!;
}

/* 把本人已有的某个邮箱设为主邮箱。 */
export async function setPrimaryEmail(userId: string, raw: string): Promise<void> {
  const email = normalizeEmail(raw);
  const mine = await emailsOf(userId);
  const target = mine.find((e) => e.email === email);
  if (!target) throw new ApiException('NOT_FOUND', '该邮箱不属于当前用户');
  if (target.isPrimary) return;
  await db.update(userEmails).set({ isPrimary: false }).where(and(eq(userEmails.userId, userId), eq(userEmails.isPrimary, true)));
  await db.update(userEmails).set({ isPrimary: true }).where(eq(userEmails.id, target.id));
}

/* 删除备用邮箱;主邮箱不可删(须先把别的邮箱设为主)。 */
export async function removeEmail(userId: string, raw: string): Promise<void> {
  const email = normalizeEmail(raw);
  const mine = await emailsOf(userId);
  const target = mine.find((e) => e.email === email);
  if (!target) throw new ApiException('NOT_FOUND', '该邮箱不属于当前用户');
  if (target.isPrimary) throw new ApiException('VALIDATION_FAILED', '主邮箱不可删除,请先设置其他主邮箱');
  await db.delete(userEmails).where(eq(userEmails.id, target.id));
}

/* Lark/飞书 OAuth 专用:把 IdP 返回的邮箱登记为 verified。
   - 已属于本人 → 补标 verified(并保留主/备属性);
   - 不存在 → 插入 verified 行(用户还没有主邮箱时同时设为 primary);
   - 属于他人 → 记日志跳过(账号合并不在本期范围)。 */
export async function upsertVerifiedEmail(userId: string, raw: string): Promise<void> {
  const email = raw.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return;
  const [row] = await db
    .select()
    .from(userEmails)
    .where(sql`lower(${userEmails.email}) = ${email}`)
    .limit(1);
  if (row) {
    if (row.userId !== userId) {
      console.warn(`[emails] verified email ${email} belongs to another user; skipped for ${userId}`);
      return;
    }
    if (!row.verified) await db.update(userEmails).set({ verified: true }).where(eq(userEmails.id, row.id));
    return;
  }
  const hasPrimary = !!(await primaryEmailOf(userId));
  await db.insert(userEmails).values({
    id: crypto.randomUUID(),
    userId,
    email,
    isPrimary: !hasPrimary,
    verified: true,
  });
}
