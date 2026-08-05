import { put } from '@vercel/blob';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { issues, members, notionConnections, notionIssueLinks } from '@/db/schema';
import { findUserByEmail } from '@/lib/emails';
import { ApiException } from '@/lib/envelope';
import { rulesRecord, type NotionStatusRule } from '@/lib/notionStatusMap';
import { requirePerm } from '@/lib/permissions';
import {
  downloadFile,
  getPageBlocks,
  queryDatabase,
  type NotionBlockObject,
  type NotionPageObject,
} from '@/server/notion';
import { registerAttachment } from './attachments';
import { createIssue, updateIssue, type IssueStatus, type IssueType } from './issues';
import type { Actor } from './types';

/* Notion → SPMS 单向同步引擎(阶段 2)。以点击「同步」用户的 Actor 调
   createIssue/updateIssue/registerAttachment,RBAC 与活动日志自然复用。

   幂等:notion_issue_links 记录 (connectionId, notionPageId) ↔ issue 映射与
   页面 last_edited_time;逐条比对水位跳过未变更页,连接级 lastSyncedAt 作为
   查询水位(越过即停止翻页)。

   v1 字段映射与客户「CRM Requests」库的真实记录结构对齐(属性名硬编码):
   Name(title)/Request Description(rich_text)/Status(status)/Assigned To
   (people)/Files & media(files)/Tags(multi_select)/Id(unique_id);
   描述 = 头行 + Request Description 属性 + 页面正文 blocks 纯文本(客户库的
   实际内容多写在页面正文里)。
   Status → SPMS status 的映射与「是否同步」由连接的 statusMap 配置驱动
   (设置页可改;未配置回退 lib/notionStatusMap 的内置默认)。
   展示 key 采用 Id(unique_id)的 "CRM-518"(缺失才按类型自动分配);
   创建时间回写 Notion created_time,done 的完成时间同值回写(真实完成
   时刻不可考的最佳近似);老数据随页面变更逐条收敛;
   老数据追平(页面未变更也执行):key 追平为 unique_id;映射状态与现值
   不一致时照常走完整更新。
   v1 明示限制:附件只在新建时同步,后续新增的图片不补;正文 blocks 只取
   顶层,不递归子块(toggle/嵌套列表里的内容不取)。 */

const PROP = {
  title: 'Name',
  description: 'Request Description',
  status: 'Status',
  assignee: 'Assigned To',
  files: 'Files & media',
  tags: 'Tags',
  uniqueId: 'Id',
} as const;

export interface NotionSyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

type ConnectionRow = typeof notionConnections.$inferSelect;
type Outcome = 'created' | 'updated' | 'skipped';

/* ---- Notion 属性收窄(按名字取值,宽松结构) ---- */

function titleText(page: NotionPageObject): string {
  const p = page.properties?.[PROP.title] as { title?: { plain_text?: string }[] } | undefined;
  return (p?.title ?? []).map((t) => t.plain_text ?? '').join('').trim();
}

function richText(page: NotionPageObject, name: string): string {
  const p = page.properties?.[name] as { rich_text?: { plain_text?: string }[] } | undefined;
  return (p?.rich_text ?? []).map((t) => t.plain_text ?? '').join('').trim();
}

function statusName(page: NotionPageObject): string | null {
  const p = page.properties?.[PROP.status] as { status?: { name?: string } | null } | undefined;
  return p?.status?.name ?? null;
}

function tagNames(page: NotionPageObject): string[] {
  const p = page.properties?.[PROP.tags] as { multi_select?: { name?: string }[] } | undefined;
  return (p?.multi_select ?? []).map((t) => t.name ?? '').filter(Boolean);
}

/* Notion unique_id 的 prefix-number("CRM-518"),缺失 → undefined。 */
function notionUniqueId(page: NotionPageObject): string | undefined {
  const p = page.properties?.[PROP.uniqueId] as
    | { unique_id?: { prefix?: string | null; number?: number } | null }
    | undefined;
  const uid = p?.unique_id;
  if (uid?.number == null) return undefined;
  return uid.prefix ? `${uid.prefix}-${uid.number}` : String(uid.number);
}

/* 描述头行里的记录标识:unique_id("CRM-518"),缺省退回页面 id。 */
function pageLabel(page: NotionPageObject): string {
  return notionUniqueId(page) ?? page.id;
}

/* undefined = 未开通 email 能力(people 拿不到 email)→ 创建置 null、更新不动;
   null = 未指派/无匹配 → 创建与更新都置 null(Notion 为真源)。 */
function assigneeEmail(page: NotionPageObject): string | null | undefined {
  const p = page.properties?.[PROP.assignee] as
    | { people?: { person?: { email?: string | null } | null }[] }
    | undefined;
  const first = p?.people?.[0];
  if (!first) return null;
  const email = first.person?.email?.trim();
  return email ? email : undefined;
}

interface FileRef {
  name?: string;
  type?: string;
  file?: { url?: string };
  external?: { url?: string };
}

function fileRefs(page: NotionPageObject): FileRef[] {
  const p = page.properties?.[PROP.files] as { files?: FileRef[] } | undefined;
  return p?.files ?? [];
}

/* ---- 映射规则 ---- */

/* Notion Status.name → SPMS status(大小写不敏感);归档/回收站优先 → canceled。
   规则来自连接的 statusMap(lib/notionStatusMap;未配置回退内置默认映射);
   未知名或映射为 null → undefined(创建按 todo,更新不动)。 */
function mapStatus(page: NotionPageObject, rules: Record<string, NotionStatusRule>): IssueStatus | undefined {
  if (page.archived || page.in_trash) return 'canceled';
  const name = statusName(page);
  return name ? (rules[name.trim().toLowerCase()]?.status ?? undefined) : undefined;
}

/* Tags → type:含 "BUGS" → bug;否则含 Feature/Updated/Change → ticket;否则 bug。 */
function mapType(page: NotionPageObject): IssueType {
  const tags = tagNames(page).map((t) => t.trim().toLowerCase());
  if (tags.includes('bugs')) return 'bug';
  if (tags.some((t) => t === 'feature' || t === 'updated' || t === 'change')) return 'ticket';
  return 'bug';
}

/* 描述 = 头行(每次更新都重新生成,兼作 More info needed 等状态的备注位)
   + Request Description 属性纯文本(如有)+ 页面正文 blocks 纯文本(如有)。 */
function buildDescription(page: NotionPageObject, bodyText: string): string {
  const header = `Notion: ${pageLabel(page)} · ${statusName(page) ?? '—'} · ${page.url ?? ''}`;
  return [header, richText(page, PROP.description), bodyText].filter(Boolean).join('\n\n');
}

/* ---- 页面正文 blocks → 纯文本 ---- */

/* 单个 block → 一行纯文本(Markdown 风格前缀);未覆盖的类型(含 image,
   走附件通道)返回空串跳过。 */
function blockText(block: NotionBlockObject): string {
  const payload = block[block.type] as { rich_text?: { plain_text?: string }[] } | undefined;
  const text = (payload?.rich_text ?? []).map((t) => t.plain_text ?? '').join('').trim();
  if (!text) return '';
  switch (block.type) {
    case 'heading_1':
      return `# ${text}`;
    case 'heading_2':
      return `## ${text}`;
    case 'heading_3':
      return `### ${text}`;
    case 'bulleted_list_item':
      return `- ${text}`;
    case 'numbered_list_item':
      return `1. ${text}`;
    case 'to_do':
      return `- [${(payload as { checked?: boolean }).checked ? 'x' : ' '}] ${text}`;
    case 'quote':
      return `> ${text}`;
    case 'paragraph':
    case 'callout':
    case 'toggle':
    case 'code':
      return text;
    default:
      return '';
  }
}

function blocksToText(blocks: NotionBlockObject[]): string {
  return blocks.map(blockText).filter(Boolean).join('\n');
}

/* 页面正文 blocks:描述正文与图片附件都从这里取,每个被同步的页面只拉一次;
   失败记 errors、按空处理,不阻断同步。v1 只取顶层 blocks,不递归子块
   (toggle/嵌套列表里的内容不取)。 */
async function fetchBlocks(
  conn: ConnectionRow,
  page: NotionPageObject,
  errors: string[],
): Promise<NotionBlockObject[]> {
  try {
    return await getPageBlocks(conn.accessToken, page.id);
  } catch (e) {
    errors.push(`${pageLabel(page)}: 读取内容块失败 (${errMsg(e)})`);
    return [];
  }
}

/* 邮箱 → 本公司指派人,两级匹配:
   1. user_emails(主/备,大小写不敏感)命中平台用户 → 其在本公司的 member
      投影(内部成员的 members.email 为 NULL,必须经用户邮箱表才能匹配到);
   2. 回退 members.email(外部邀请/存量行)。 */
async function resolveAssignee(companyId: string, email: string): Promise<string | null> {
  const userId = await findUserByEmail(email);
  if (userId) {
    const [m] = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.companyId, companyId), eq(members.userId, userId)))
      .limit(1);
    if (m) return m.id;
  }
  const [m] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.companyId, companyId), sql`lower(${members.email}) = ${email.trim().toLowerCase()}`))
    .limit(1);
  return m?.id ?? null;
}

/* 页面 → assigneeId 入参:undefined = 更新不动(无 email 能力);
   null/成员 id = 创建与更新都生效(Notion 为真源)。 */
async function resolveAssigneeInput(companyId: string, page: NotionPageObject) {
  const email = assigneeEmail(page);
  return email === undefined ? undefined : email === null ? null : await resolveAssignee(companyId, email);
}

/* ---- 附件(仅新建时) ---- */

const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

function imageMimeFromName(name: string): string | null {
  const ext = name.split('?')[0].toLowerCase().split('.').pop() ?? '';
  return IMAGE_MIME[ext] ?? null;
}

/* 从(预签名)URL 推导文件名;取不到图片扩展名时返回 null。 */
function filenameFromUrl(url: string): string | null {
  try {
    const seg = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    return seg && imageMimeFromName(seg) ? seg : null;
  } catch {
    return null;
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function syncAttachments(
  actor: Actor,
  page: NotionPageObject,
  blocks: NotionBlockObject[],
  issueKey: string,
  errors: string[],
): Promise<void> {
  const candidates: { name: string; url: string }[] = [];
  // Files & media 属性:按扩展名判图片,非图片直接跳过。
  for (const f of fileRefs(page)) {
    const url = f.type === 'external' ? f.external?.url : f.file?.url;
    if (url && imageMimeFromName(f.name ?? '')) candidates.push({ name: f.name ?? 'image', url });
  }
  // 页面内容里的 image blocks(blocks 由 syncPage 统一拉取)。
  for (const b of blocks) {
    if (b.type !== 'image') continue;
    const img = b.image as FileRef | undefined;
    const url = img?.type === 'external' ? img?.external?.url : img?.file?.url;
    if (url) candidates.push({ name: filenameFromUrl(url) ?? `${b.id}.png`, url });
  }

  for (const c of candidates) {
    try {
      const dl = await downloadFile(c.url); // >10MB → null(跳过)
      if (!dl) continue;
      const contentType =
        imageMimeFromName(c.name) ??
        (dl.contentType?.startsWith('image/') ? dl.contentType.split(';')[0] : null);
      if (!contentType) continue; // 无法确认是图片 → 跳过
      const safeName = c.name.split(/[\\/]/).pop() || 'image';
      const blob = await put(`issues/${actor.companyId}/${crypto.randomUUID()}-${safeName}`, dl.buffer, {
        access: 'public',
        contentType,
        addRandomSuffix: true,
      });
      await registerAttachment(actor, issueKey, {
        url: blob.url,
        pathname: blob.pathname,
        filename: safeName,
        contentType,
        size: dl.buffer.length,
      });
    } catch (e) {
      errors.push(`${pageLabel(page)}: 附件 ${c.name} (${errMsg(e)})`);
    }
  }
}

/* ---- 单条记录 ---- */

async function syncPage(
  actor: Actor,
  conn: ConnectionRow,
  page: NotionPageObject,
  errors: string[],
): Promise<Outcome> {
  const [link] = await db
    .select()
    .from(notionIssueLinks)
    .where(and(eq(notionIssueLinks.connectionId, conn.id), eq(notionIssueLinks.notionPageId, page.id)))
    .limit(1);
  const edited = new Date(page.last_edited_time);
  // 过滤规则:该 Notion 状态被配置为不同步 → 整页跳过(不动 issue、不推进链接水位)。
  const rules = rulesRecord(conn.statusMap);
  const sName = statusName(page)?.trim().toLowerCase();
  if (sName && rules[sName] && !rules[sName].sync) return 'skipped';
  // Notion created_time 是 issue 的真实创建时间(createIssue 落的是同步时刻),
  // 创建与更新两条路径都回写,老数据随页面变更逐条收敛。
  const notionCreatedAt = page.created_time ? new Date(page.created_time) : null;
  // SPMS 展示 key 直接采用 Notion unique_id("CRM-518");缺失则按类型自动分配。
  const wantedKey = notionUniqueId(page);

  if (link) {
    // issue 删除会 cascade 掉 link 行,所以 link 在而 issue 不在只可能是数据不一致。
    const [issueRow] = await db
      .select({ key: issues.key, status: issues.status })
      .from(issues)
      .where(eq(issues.id, link.issueId))
      .limit(1);
    if (!issueRow) throw new ApiException('ISSUE_NOT_FOUND', `映射的 Issue ${link.issueId} 不存在`);
    // 老数据(自动分配的 TKT-N 等)追平:把展示 key 改成 Notion unique_id。放在水位
    // 判断之前,页面未变更的已同步记录也能改名;key 被占用时保留原 key 并记入 errors。
    if (wantedKey && wantedKey !== issueRow.key) {
      const [taken] = await db
        .select({ id: issues.id })
        .from(issues)
        .where(and(eq(issues.companyId, actor.companyId), eq(issues.key, wantedKey)))
        .limit(1);
      if (taken) {
        errors.push(`${pageLabel(page)}: key ${wantedKey} 已被占用,保留 ${issueRow.key}`);
      } else {
        await db.update(issues).set({ key: wantedKey }).where(eq(issues.id, link.issueId));
        issueRow.key = wantedKey;
      }
    }
    // 水位跳过之外的追平:映射状态与现值不一致(如 Closed→done 是后加的映射,
    // 老数据当时按 todo 落了库)时照常走完整更新,收敛后才真正 skipped。
    const mappedStatus = mapStatus(page, rules);
    const statusStale = mappedStatus !== undefined && mappedStatus !== issueRow.status;
    if (!statusStale && link.notionLastEditedAt && link.notionLastEditedAt >= edited) return 'skipped';

    const title = titleText(page) || pageLabel(page);
    const blocks = await fetchBlocks(conn, page, errors);
    const assigneeId = await resolveAssigneeInput(actor.companyId, page);
    await updateIssue(actor, issueRow.key, {
      title,
      description: buildDescription(page, blocksToText(blocks)),
      type: mapType(page),
      ...(mappedStatus !== undefined ? { status: mappedStatus } : {}),
      ...(assigneeId !== undefined ? { assigneeId } : {}),
    });
    // done 的完成时间同样回写为 created_time(真实完成时刻不可考的最佳近似)。
    const finalStatus = mappedStatus ?? issueRow.status;
    if (notionCreatedAt) {
      await db
        .update(issues)
        .set({ createdAt: notionCreatedAt, ...(finalStatus === 'done' ? { completedAt: notionCreatedAt } : {}) })
        .where(eq(issues.id, link.issueId));
    }
    await db
      .update(notionIssueLinks)
      .set({ notionLastEditedAt: edited })
      .where(eq(notionIssueLinks.id, link.id));
    return 'updated';
  }

  const title = titleText(page) || pageLabel(page);
  const status = mapStatus(page, rules);
  const blocks = await fetchBlocks(conn, page, errors);
  const assigneeId = await resolveAssigneeInput(actor.companyId, page);
  const created = await createIssue(actor, {
    title,
    description: buildDescription(page, blocksToText(blocks)),
    type: mapType(page),
    status: status ?? 'todo',
    assigneeId: assigneeId ?? null,
    projectId: conn.projectId,
    ...(wantedKey ? { key: wantedKey } : {}),
  });
  // created.id 是展示 key;link 行存内部 issues.id。
  const [row] = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.companyId, actor.companyId), eq(issues.key, created.id)))
    .limit(1);
  if (!row) throw new Error('新建 Issue 回读失败');
  if (notionCreatedAt) {
    await db
      .update(issues)
      .set({ createdAt: notionCreatedAt, ...((status ?? 'todo') === 'done' ? { completedAt: notionCreatedAt } : {}) })
      .where(eq(issues.id, row.id));
  }
  await syncAttachments(actor, page, blocks, created.id, errors);
  await db.insert(notionIssueLinks).values({
    id: crypto.randomUUID(),
    companyId: actor.companyId,
    connectionId: conn.id,
    notionPageId: page.id,
    issueId: row.id,
    notionLastEditedAt: edited,
  });
  return 'created';
}

/* ---- 入口 ---- */

/* 手动触发一次同步:拉取水位以来的变更页,逐条创建/更新/跳过,单条失败记
   errors 继续;结束后推进 lastSyncedAt 水位(本轮见过的最新 last_edited_time,
   没有变更则置为 now)。
   full=true 全量重同步:忽略连接水位重拉全部页面(用于 issue 被直接删除后的
   重建等场景——删除只级联清映射,不触碰 Notion 的 last_edited_time,增量同步
   永远拉不回这些页)。幂等不变:映射仍在且未变更的页照旧 skipped,只有缺失/
   变更的页才会创建/更新。 */
export async function syncNotion(actor: Actor, opts?: { full?: boolean }): Promise<NotionSyncResult> {
  await requirePerm(actor, 'issues', 'write');
  const [conn] = await db
    .select()
    .from(notionConnections)
    .where(eq(notionConnections.companyId, actor.companyId))
    .limit(1);
  if (!conn) throw new ApiException('NOT_FOUND', '尚未连接 Notion');
  if (!conn.databaseId) throw new ApiException('VALIDATION_FAILED', '请先在设置页选择要同步的数据库');
  if (!conn.projectId) throw new ApiException('VALIDATION_FAILED', '请先在设置页选择目标项目');

  let pages: NotionPageObject[];
  try {
    pages = await queryDatabase(conn.accessToken, conn.databaseId, opts?.full ? null : conn.lastSyncedAt);
  } catch (e) {
    throw new ApiException('INTERNAL', errMsg(e));
  }

  const result: NotionSyncResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  let maxEdited: Date | null = null;
  for (const page of pages) {
    const edited = new Date(page.last_edited_time);
    if (!maxEdited || edited > maxEdited) maxEdited = edited;
    try {
      const outcome = await syncPage(actor, conn, page, result.errors);
      result[outcome] += 1;
    } catch (e) {
      result.errors.push(`${pageLabel(page)}: ${errMsg(e)}`);
    }
  }

  await db
    .update(notionConnections)
    .set({ lastSyncedAt: maxEdited ?? new Date(), updatedAt: new Date() })
    .where(eq(notionConnections.id, conn.id));
  return result;
}
