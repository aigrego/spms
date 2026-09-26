import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { attachments, issues, requirements, testCases } from '@/db/schema';
import { serializeAttachment } from '@/lib/serialize';
import { ApiException } from '@/lib/envelope';
import { isAllowedType } from '@/lib/attachments';
import { levelFor, requirePerm, type CompanyModule } from '@/lib/permissions';
import { storageForCompany, type AttachmentCategory } from '@/server/storage';
import type { Actor } from './types';

/* Attachments on issues / test cases / requirements (per-company storage
   backend, client-direct upload). The browser uploads straight to the
   company's backend via the /attachments/upload intent route, then
   registerAttachment persists the row (server-side meta validation via
   storage.assertMeta). Reads go through the /attachments/object proxy
   (company isolation). Deleting removes the row first, then the object
   (best-effort — a failed delete leaves an orphan for
   scripts/reconcile-attachments.ts). Module gate follows the owner entity
   (issues/testcases/requirements write). */

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

export interface RegisterAttachmentInput {
  url: string;
  pathname: string; // = 对象 key（{companyId}/{category}/{userSegment}/{fileType}/{uuid}-{safeName}）
  filename: string;
  contentType: string;
  size: number;
}

/* The entity an attachment hangs on, addressed by its display key. */
export interface AttachmentEntityRef {
  type: 'issue' | 'testCase' | 'requirement';
  key: string; // display key (TKT-3 / BUG-3 / TC-1 / FR-2 / NFR-1)
}

type OwnerFkField = 'issueId' | 'testCaseId' | 'requirementId';

interface EntityConf {
  /* 闸门与落列的映射单点维护(计划 §2 约定):permission module、对象 key
     category 段、FK 列、实体存在性查询、not-found 错误(沿用各 service
     既有错误码与消息风格)。 */
  module: CompanyModule;
  category: AttachmentCategory;
  fkField: OwnerFkField;
  fkColumn: typeof attachments.issueId | typeof attachments.testCaseId | typeof attachments.requirementId;
  findId: (companyId: string, key: string) => Promise<string | undefined>;
  notFound: (key: string) => ApiException;
}

const ENTITY_CONF: Record<AttachmentEntityRef['type'], EntityConf> = {
  issue: {
    module: 'issues',
    category: 'issues',
    fkField: 'issueId',
    fkColumn: attachments.issueId,
    findId: async (companyId, key) => {
      const [row] = await db
        .select({ id: issues.id })
        .from(issues)
        .where(and(eq(issues.companyId, companyId), eq(issues.key, key)))
        .limit(1);
      return row?.id;
    },
    notFound: (key) => new ApiException('ISSUE_NOT_FOUND', `Issue ${key} 不存在`),
  },
  testCase: {
    module: 'testcases',
    category: 'cases',
    fkField: 'testCaseId',
    fkColumn: attachments.testCaseId,
    findId: async (companyId, key) => {
      const [row] = await db
        .select({ id: testCases.id })
        .from(testCases)
        .where(and(eq(testCases.companyId, companyId), eq(testCases.key, key)))
        .limit(1);
      return row?.id;
    },
    notFound: (key) => new ApiException('TEST_CASE_NOT_FOUND', `测试用例 ${key} 不存在`),
  },
  requirement: {
    module: 'requirements',
    category: 'requirements',
    fkField: 'requirementId',
    fkColumn: attachments.requirementId,
    findId: async (companyId, key) => {
      const [row] = await db
        .select({ id: requirements.id })
        .from(requirements)
        .where(and(eq(requirements.companyId, companyId), eq(requirements.key, key)))
        .limit(1);
      return row?.id;
    },
    notFound: (key) => new ApiException('REQUIREMENT_NOT_FOUND', `需求 ${key} 不存在`),
  },
};

const ownerValues = (fkField: OwnerFkField, id: string) => {
  switch (fkField) {
    case 'issueId':
      return { issueId: id };
    case 'testCaseId':
      return { testCaseId: id };
    case 'requirementId':
      return { requirementId: id };
  }
};

/* ---- register an already-uploaded object as an entity attachment ----
   闸门顺序:requirePerm(对应 module write) → 实体存在 → meta 非空 →
   assertMeta(前缀/category/userSegment 三段比对) → contentType allow-list
   → size → 插入对应 FK 列。 */
export async function registerAttachment(actor: Actor, entity: AttachmentEntityRef, meta: RegisterAttachmentInput) {
  const conf = ENTITY_CONF[entity.type];
  await requirePerm(actor, conf.module, 'write');
  const companyId = actor.companyId;
  const entityId = await conf.findId(companyId, entity.key);
  if (!entityId) throw conf.notFound(entity.key);

  if (!meta.url?.trim() || !meta.pathname?.trim()) {
    throw new ApiException('VALIDATION_FAILED', '附件 url/pathname 不能为空');
  }
  // 不信任客户端上报的 url/pathname：必须属于本公司存储后端与本公司的 key 前缀，
  // 且 category/userSegment 段须与签发时一致（category 由实体类型映射，
  // userSegment 恒为操作人 memberId——客户端不能指定 key 的任何一段）。
  const storage = await storageForCompany(companyId);
  storage.assertMeta(meta.url, meta.pathname, { category: conf.category, userSegment: actor.memberId ?? 'system' });
  if (!meta.contentType || !isAllowedType(meta.contentType)) {
    throw new ApiException('VALIDATION_FAILED', '不支持的附件格式');
  }
  if (!Number.isFinite(meta.size) || meta.size <= 0 || meta.size > MAX_ATTACHMENT_SIZE) {
    throw new ApiException('VALIDATION_FAILED', '附件大小需在 10MB 以内');
  }

  const id = crypto.randomUUID();
  await db.insert(attachments).values({
    id,
    companyId,
    ...ownerValues(conf.fkField, entityId),
    url: meta.url,
    objectKey: meta.pathname,
    filename: meta.filename?.trim() || 'file',
    contentType: meta.contentType,
    size: meta.size,
    uploadedById: actor.memberId,
  });
  const [row] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
  return serializeAttachment(row);
}

/* ---- 公司附件总表(设置 → 附件 面板):本公司全部附件,左联出归属实体的
   展示 key/标题。读闸门:issues/testcases/requirements 任一模块 read 即可
   (附件必挂在这三类实体之一),三者皆 none 时 403。行级隔离靠
   attachments.companyId = actor.companyId。 */
export async function listCompanyAttachments(actor: Actor) {
  if (!actor.isPlatformAdmin && actor.companyRole !== 'company_admin') {
    const levels = await Promise.all(
      (['issues', 'testcases', 'requirements'] as const).map((m) =>
        levelFor(actor.companyRole, m, actor.companyId),
      ),
    );
    if (levels.every((l) => l === 'none')) {
      throw new ApiException('FORBIDDEN', '没有该模块的访问权限', 403);
    }
  }
  const rows = await db
    .select({
      attachment: attachments,
      issueKey: issues.key,
      issueTitle: issues.title,
      testCaseKey: testCases.key,
      testCaseTitle: testCases.title,
      requirementKey: requirements.key,
      requirementTitle: requirements.title,
    })
    .from(attachments)
    .leftJoin(issues, eq(attachments.issueId, issues.id))
    .leftJoin(testCases, eq(attachments.testCaseId, testCases.id))
    .leftJoin(requirements, eq(attachments.requirementId, requirements.id))
    .where(eq(attachments.companyId, actor.companyId))
    .orderBy(desc(attachments.createdAt));
  return rows.map((r) => ({
    ...serializeAttachment(r.attachment),
    owner: r.issueKey
      ? { type: 'issue' as const, key: r.issueKey, title: r.issueTitle ?? '' }
      : r.testCaseKey
        ? { type: 'testCase' as const, key: r.testCaseKey, title: r.testCaseTitle ?? '' }
        : r.requirementKey
          ? { type: 'requirement' as const, key: r.requirementKey, title: r.requirementTitle ?? '' }
          : null,
  }));
}

/* ---- delete: 按行实际 owner FK 分支 requirePerm;先删 DB 行再删对象,对象
   删除失败只记告警不抛错 —— 孤儿由 scripts/reconcile-attachments.ts 对账
   清理,不影响行已删的事实 ---- */export async function deleteAttachment(actor: Actor, attachmentId: string) {
  const [row] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.companyId, actor.companyId), eq(attachments.id, attachmentId)))
    .limit(1);
  if (!row) throw new ApiException('ATTACHMENT_NOT_FOUND');
  // 权限跟随行的实际归属实体(CHECK 保证恰一 FK 非空;issueId 兜底分支
  // 只为类型完备,正常行必中其一)。
  const ownerModule: CompanyModule = row.testCaseId ? 'testcases' : row.requirementId ? 'requirements' : 'issues';
  await requirePerm(actor, ownerModule, 'write');
  await db.delete(attachments).where(eq(attachments.id, row.id));
  // objectKey 为 null 的是平台级 Vercel Blob 时代的旧行:运行时已不再持有那个
  // token,删除留给 reconcile 脚本(--apply)按存量 token 处理。
  if (row.objectKey) {
    try {
      const storage = await storageForCompany(actor.companyId);
      await storage.del(row.objectKey);
    } catch (e) {
      console.warn(`[attachments] 对象删除失败,留待对账清理: ${row.objectKey}`, e);
    }
  }
  return { id: row.id };
}
