import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { labels } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { requirePerm } from '@/lib/permissions';
import type { Actor } from './types';

/* Labels 业务服务（BUG-17）。此前标签只能 seed/ensureAiLabel 预置，这里补上
   现场自定义的创建入口。`key` 是稳定句柄（内置标签用语义 key，如 'ai'）；
   现场创建的统一生成 `custom_<8hex>`，展示只走 name。 */
export async function create(actor: Actor, input: { name: string; color: string }) {
  await requirePerm(actor, 'issues', 'write');
  const name = input.name.trim();
  if (!name) throw new ApiException('VALIDATION_FAILED', '标签名称不能为空');
  const [dupe] = await db
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.companyId, actor.companyId), eq(labels.name, name)))
    .limit(1);
  if (dupe) throw new ApiException('CONFLICT', '同名标签已存在');
  const id = crypto.randomUUID();
  const [row] = await db
    .insert(labels)
    .values({ id, companyId: actor.companyId, key: `custom_${id.slice(0, 8)}`, name, color: input.color })
    .returning();
  return row!;
}
