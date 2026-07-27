/* Notion Status.name → SPMS status 的映射/过滤规则(notion_connections.statusMap)。
   每个 Notion 状态一条:sync=false 不同步该状态的页面;status=null 不映射
   (创建按 todo,更新不动)。连接未配置(statusMap NULL)时回退内置默认映射,
   行为与配置前一致。 */

export type SpmsStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'canceled';

export const SPMS_STATUSES: SpmsStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'];

export interface NotionStatusRule {
  /** Notion 侧状态名(大小写不敏感匹配;存原始大小写用于展示) */
  name: string;
  status: SpmsStatus | null;
  sync: boolean;
}

/* 内置默认映射(原 notionSync 的硬编码 STATUS_MAP),全部 sync。 */
export const DEFAULT_STATUS_MAP: Record<string, SpmsStatus> = {
  'not started': 'todo',
  'in progress': 'in_progress',
  'more info needed': 'in_progress',
  'ready for testing': 'in_review',
  done: 'done',
  closed: 'done',
  'no progress': 'canceled',
};

/* 同步引擎查找用:小写状态名 → 规则。saved 为 NULL 时由默认映射构造。 */
export function rulesRecord(saved: NotionStatusRule[] | null | undefined): Record<string, NotionStatusRule> {
  if (saved?.length) {
    return Object.fromEntries(saved.map((r) => [r.name.trim().toLowerCase(), r]));
  }
  return Object.fromEntries(
    Object.entries(DEFAULT_STATUS_MAP).map(([name, status]) => [name, { name, status, sync: true }]),
  );
}

/* 设置页展示用:Notion 数据库当前的状态选项 ∪ 已存规则,未配置的选项按
   默认映射猜测、默认 sync。已存规则里已不存在于选项中的条目保留(不丢配置)。 */
export function mergeStatusRules(optionNames: string[], saved: NotionStatusRule[] | null | undefined): NotionStatusRule[] {
  const savedRec = rulesRecord(saved?.length ? saved : null);
  const out: NotionStatusRule[] = [];
  const seen = new Set<string>();
  for (const name of optionNames) {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(savedRec[key] ?? { name, status: DEFAULT_STATUS_MAP[key] ?? null, sync: true });
  }
  for (const r of saved ?? []) {
    const key = r.name.trim().toLowerCase();
    if (key && !seen.has(key)) out.push(r);
  }
  return out;
}
