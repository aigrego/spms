import type { Activity, IssueStatus } from './types';

/* 系统动态(创建/状态流转/归档/指派)的结构化文案(TKT-253,收口 BUG-16):
   不再落中文模板,body 存 JSON {k, p?},渲染端按 k 走 i18n;存量中文行由
   渲染端正则兜底,不迁移也能正常显示。kind 列保持粗粒度语义(summary 统计、
   前端 isComment/isAI 分支都读它),k 给细粒度事件。评论/AI 文本是用户内容,
   不经此 helper,body 原样落库。 */

export type ActivityKind = Activity['kind'];

export type ActivityEvent =
  | { k: 'created' }
  | { k: 'statusChanged'; p: { status: IssueStatus } }
  | { k: 'assigned'; p: { name: string } }
  | { k: 'archived' }
  | { k: 'unarchived' };

const EVENT_KIND: Record<ActivityEvent['k'], ActivityKind> = {
  created: 'created',
  statusChanged: 'status',
  archived: 'status',
  unarchived: 'status',
  assigned: 'assign',
};

/* 服务端写 activities 的统一入口(系统事件):给出 kind + 结构化 body。 */
export function systemActivity(ev: ActivityEvent): { kind: ActivityKind; body: string } {
  return { kind: EVENT_KIND[ev.k], body: JSON.stringify(ev) };
}

/* 渲染端解析:命中结构化格式返回事件,否则(存量中文模板/评论/AI 文本)返回 null。 */
export function parseActivityEvent(body: string): ActivityEvent | null {
  if (body.charCodeAt(0) !== 123 /* '{' */) return null;
  try {
    const v: unknown = JSON.parse(body);
    if (
      v &&
      typeof v === 'object' &&
      typeof (v as { k?: unknown }).k === 'string' &&
      (v as { k: string }).k in EVENT_KIND
    ) {
      return v as ActivityEvent;
    }
  } catch {
    /* 非 JSON:存量纯文本 */
  }
  return null;
}
