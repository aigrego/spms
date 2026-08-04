'use client';

import * as React from 'react';
import { CalendarDays, Check, ChevronDown, ClipboardCopy, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger, MenuItem } from '@/components/ui/popover';
import { SegBtn, TabBtn } from '@/components/ui/segmented';
import { Avatar } from '@/components/glyphs/Avatar';
import { Markdown } from '@/components/Markdown';
import { Skeleton } from '@/components/StateBlock';
import { relativeTime } from '@/lib/time';
import { useT } from '@/lib/i18n';
import { useAppData } from '@/store/AppData';
import { useDeleteReport, useMyReport, useReports, useReportStats, useSaveMyReport } from '@/store/reports';
import type { DailyReport, DailyReportEntry, Member, Product } from '@/lib/types';

/* 日报视图 — 「写日报」+「日报汇总」两个页签。
   汇总支持三种维度:按产品(产品 → 人员 → 任务,默认)、按人员(人员 → 产品 → 任务)、
   按负责人(负责人 → 产品 → 人员 → 任务,TKT-10),支持一键复制。
   日期一律用客户端本地时区的 'YYYY-MM-DD'(服务端只做不透明 day key)。 */

function localToday(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const dateInputCls =
  'h-8 rounded-md border border-border-strong bg-surface px-2.5 text-[13px] text-fg-1 outline-none focus:border-brand-blue';

function ProductDot({ product, size = 8 }: { product?: Product; size?: number }) {
  return (
    <span
      className="inline-block flex-none rounded-full"
      style={{ width: size, height: size, background: product?.color ?? 'var(--fg-3)' }}
    />
  );
}

/* 内容行 → 任务条目:按行拆分,去掉常见列表前缀(1. / a. / - / •)。 */
function toTaskLines(content: string): string[] {
  return content
    .split('\n')
    .map((l) => l.replace(/^\s*(?:\d+[.、)]|[a-zA-Z][.)]|[-*•·])\s*/, '').trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* 写日报                                                              */
/* ------------------------------------------------------------------ */

function WriteReport({ me, products }: { me: Member | undefined; products: Product[] }) {
  const t = useT();
  const [date, setDate] = React.useState(localToday);
  const { data: existing, isLoading } = useMyReport(me ? date : null);

  if (!me) {
    return <div className="py-16 text-center text-[13px] text-fg-3">需要公司席位才能提交日报,请联系管理员分配。</div>;
  }

  return (
    <div className="mx-auto max-w-[760px]">
      <div className="mb-4 flex items-center gap-3">
        <CalendarDays size={15} className="text-fg-3" />
        <input type="date" value={date} max={localToday()} onChange={(e) => setDate(e.target.value)} className={dateInputCls} />
        {date === localToday() && <span className="text-[12px] text-fg-3">今天</span>}
        <div className="flex-1" />
        {existing && (
          <span className="text-[12px] text-fg-3">上次更新 {relativeTime(existing.updatedAt, t)}</span>
        )}
      </div>
      {/* 按日期 key 重挂载:切日期时用该日已有日报初始化编辑器,避免 effect 同步。 */}
      {isLoading ? (
        <Skeleton rows={5} />
      ) : (
        <ReportEditor key={date} date={date} initial={existing ?? null} products={products} />
      )}
    </div>
  );
}

function ReportEditor({
  date,
  initial,
  products,
}: {
  date: string;
  initial: DailyReport | null;
  products: Product[];
}) {
  const t = useT();
  const [blocks, setBlocks] = React.useState<{ productId: string; content: string }[]>(() =>
    initial ? initial.entries.map((e) => ({ productId: e.productId, content: e.content })) : [],
  );
  // 保存后拿到的 report id(首存前 initial 为 null),用于删除与按钮文案。
  const [reportId, setReportId] = React.useState<string | null>(initial?.id ?? null);
  // 保存成功时的快照,用于 dirty 判断;不随服务端 refetch 漂移。
  const snapshotOf = (bs: { productId: string; content: string }[]) =>
    JSON.stringify(bs.map((b) => ({ p: b.productId, c: b.content.trim() })).filter((b) => b.c));
  const [savedSnapshot, setSavedSnapshot] = React.useState(() => snapshotOf(blocks));
  const [feedback, setFeedback] = React.useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const save = useSaveMyReport();
  const del = useDeleteReport();

  const activeProducts = products.filter((p) => p.status !== 'archived');
  const usedIds = new Set(blocks.map((b) => b.productId));
  const productById = new Map(products.map((p) => [p.id, p]));

  const toggleProduct = (id: string) => {
    setBlocks((prev) =>
      prev.some((b) => b.productId === id) ? prev.filter((b) => b.productId !== id) : [...prev, { productId: id, content: '' }],
    );
  };

  const dirty = snapshotOf(blocks) !== savedSnapshot;
  const canSave = dirty && blocks.some((b) => b.content.trim()) && !save.isPending;

  const onSave = async () => {
    setFeedback(null);
    const entries = blocks.map((b) => ({ productId: b.productId, content: b.content })).filter((b) => b.content.trim());
    try {
      const saved = await save.mutateAsync({ date, entries });
      setReportId(saved.id);
      setSavedSnapshot(snapshotOf(blocks));
      setFeedback({ kind: 'ok', text: '已保存' });
    } catch (e) {
      setFeedback({ kind: 'err', text: e instanceof Error ? e.message : '保存失败' });
    }
  };

  const onDelete = async () => {
    if (!reportId || !window.confirm(`删除 ${date} 的日报?`)) return;
    try {
      await del.mutateAsync(reportId);
      setReportId(null);
      setBlocks([]);
      setSavedSnapshot('[]');
      setFeedback({ kind: 'ok', text: '已删除' });
    } catch (e) {
      setFeedback({ kind: 'err', text: e instanceof Error ? e.message : '删除失败' });
    }
  };

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <div className="flex-1" />
        {reportId && (
          <Button variant="ghost" size="sm" onClick={onDelete} disabled={del.isPending}>
            <Trash2 size={13} className="text-fg-3" /> 删除
          </Button>
        )}
        <Button size="sm" onClick={onSave} disabled={!canSave}>
          {save.isPending ? '保存中…' : reportId ? '更新日报' : '提交日报'}
        </Button>
      </div>

      {feedback && (
        <div
          className="mb-3 rounded-md px-3 py-2 text-[12.5px]"
          style={{
            background: feedback.kind === 'ok' ? 'var(--brand-blue-tint-8, var(--surface-2))' : 'var(--danger-tint, #fdecec)',
            color: feedback.kind === 'ok' ? 'var(--brand-blue)' : 'var(--danger, #c00)',
          }}
        >
          {feedback.text}
        </div>
      )}

      {/* 产品选择 */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {activeProducts.map((p) => {
          const used = usedIds.has(p.id);
          return (
            <button
              key={p.id}
              onClick={() => toggleProduct(p.id)}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-medium transition-colors"
              style={{
                borderColor: used ? 'var(--brand-blue)' : 'var(--border-strong)',
                background: used ? 'var(--brand-blue-tint-8, var(--surface-2))' : 'var(--surface)',
                color: used ? 'var(--brand-blue)' : 'var(--fg-2)',
              }}
            >
              <ProductDot product={p} />
              {p.name}
              {used ? <Check size={12} /> : <Plus size={12} className="text-fg-3" />}
            </button>
          );
        })}
        {activeProducts.length === 0 && <span className="text-[12.5px] text-fg-3">{t('reports.form.noActiveProducts')}</span>}
      </div>

      {/* 内容块 */}
      {blocks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong py-14 text-center text-[13px] text-fg-3">
          {t('reports.form.pickHint', { date })}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {blocks.map((b) => {
            const p = productById.get(b.productId);
            return (
              <div key={b.productId} className="rounded-lg border border-border bg-surface">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <ProductDot product={p} />
                  <span className="text-[13px] font-semibold text-fg-1">{p?.name ?? t('reports.form.unknownProduct')}</span>
                  <div className="flex-1" />
                  <button
                    onClick={() => toggleProduct(b.productId)}
                    className="rounded p-0.5 text-fg-3 hover:bg-surface-2 hover:text-fg-1"
                    title={t('reports.form.removeProduct')}
                  >
                    <X size={14} />
                  </button>
                </div>
                <Textarea
                  rows={4}
                  value={b.content}
                  onChange={(e) =>
                    setBlocks((prev) => prev.map((x) => (x.productId === b.productId ? { ...x, content: e.target.value } : x)))
                  }
                  placeholder={t('reports.form.blockPlaceholder')}
                  className="px-3 py-2.5"
                />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 日报汇总(按产品 / 按人员 / 按负责人 三种维度)                          */
/* ------------------------------------------------------------------ */

type FlatRow = { report: DailyReport; entry: DailyReportEntry };
type SummaryMode = 'product' | 'member' | 'lead';

/* 无负责人(leadId 为 null)产品的外层分组 key,不可能与 member id 冲突。 */
const NO_LEAD = '__no-lead__';

/* 分组结构:depth 2 = 外层 → 内层(行集合);depth 3 = 负责人 → 产品 → 人员(行集合)。 */
type TaskBlock = { id: string; rows: FlatRow[] };
type SummaryGroup =
  | { id: string; depth: 2; subs: TaskBlock[] }
  | { id: string; depth: 3; subs: { id: string; subs: TaskBlock[] }[] };

/* 任务内容:按 Markdown 渲染(TKT-14)。同一成员/产品可能有多条 entry,逐条渲染。 */
function TaskList({ rows }: { rows: FlatRow[] }) {
  return (
    <div className="flex flex-col gap-2 pl-1">
      {rows.map((r) => (
        <Markdown key={r.entry.id} text={r.entry.content} className="text-[13px] leading-relaxed text-fg-1" />
      ))}
    </div>
  );
}

function FilterMenu({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const current = options.find((o) => o.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 text-[13px] text-fg-2 hover:bg-surface-2">
          <span className="text-fg-3">{label}</span>
          <span className="max-w-[140px] truncate font-medium text-fg-1">{current?.name ?? '全部'}</span>
          <ChevronDown size={13} className="text-fg-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[320px] w-[200px] overflow-y-auto">
        <MenuItem label="全部" selected={value === null} onClick={() => { onChange(null); setOpen(false); }} />
        {options.map((o) => (
          <MenuItem key={o.id} label={o.name} selected={o.id === value} onClick={() => { onChange(o.id); setOpen(false); }} />
        ))}
      </PopoverContent>
    </Popover>
  );
}

/* 汇总文本(对齐向上上报格式,TKT-14 起输出简单 Markdown):
   标题与分组名加粗,任务行统一 `- ` 列表并按层级缩进,中间层保留 `1.` 编号。
     按产品:   **产品:** / 1. **成员:** /    - 任务
     按人员:   **成员:** / 1. **产品:** /    - 任务
     按负责人: **负责人:** / 1. **产品:** /    - **成员:** /      - 任务 */
function buildCopyText(
  date: string,
  groups: SummaryGroup[],
  mode: SummaryMode,
  productName: (id: string) => string,
  memberName: (id: string) => string,
  noLeadLabel: string,
): string {
  const [y, m, d] = date.split('-').map(Number);
  const out: string[] = [`**${d}/${m}/${y} 工作总结:**`, ''];
  const outerName = (g: SummaryGroup) =>
    mode === 'product' ? productName(g.id) : g.id === NO_LEAD ? noLeadLabel : memberName(g.id);
  const pushTasks = (rows: FlatRow[], indent: string) => {
    rows
      .flatMap((r) => toTaskLines(r.entry.content))
      .forEach((task) => out.push(`${indent}- ${task}`));
  };
  for (const g of groups) {
    out.push(`**${outerName(g)}:**`);
    if (g.depth === 2) {
      const innerName = (id: string) => (mode === 'product' ? memberName(id) : productName(id));
      g.subs.forEach((s, si) => {
        out.push(`${si + 1}. **${innerName(s.id)}:**`);
        pushTasks(s.rows, '   ');
        out.push('');
      });
    } else {
      g.subs.forEach((p, pi) => {
        out.push(`${pi + 1}. **${productName(p.id)}:**`);
        p.subs.forEach((s) => {
          out.push(`   - **${memberName(s.id)}:**`);
          pushTasks(s.rows, '     ');
          out.push('');
        });
      });
    }
  }
  return out.join('\n');
}

function ReportsSummary({ products, humans }: { products: Product[]; humans: Member[] }) {
  const t = useT();
  const today = localToday();
  const [date, setDate] = React.useState(today);
  const [productId, setProductId] = React.useState<string | null>(null);
  const [memberId, setMemberId] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<SummaryMode>('product');
  const [copied, setCopied] = React.useState(false);

  const { data: stats } = useReportStats(today);
  const { data: reports, isLoading } = useReports({
    startDate: date,
    endDate: date,
    productId: productId ?? undefined,
    memberId: memberId ?? undefined,
  });

  const { productById, memberById } = useAppData();
  const productName = (id: string) => productById(id)?.name ?? t('reports.form.unknownProduct');
  const memberName = (id: string) => memberById(id)?.name ?? '未知成员';

  const rows: FlatRow[] = React.useMemo(
    () => (reports ?? []).flatMap((report) => report.entries.map((entry) => ({ report, entry }))),
    [reports],
  );

  /* 分组:按产品(产品 → 人 → 任务)/ 按人员(人 → 产品 → 任务)/ 按负责人(负责人 → 产品 → 人 → 任务)。
     TKT-10 工单原文是「负责人维度的 项目 → 人」;因 TKT-7 已定条目粒度为产品,
     统一实现为 负责人 → 产品 → 人。leadId 为空的产品归入「未指定负责人」组,排最后。 */
  const groups = React.useMemo<SummaryGroup[]>(() => {
    const bucket = (rs: FlatRow[], key: (r: FlatRow) => string) => {
      const by = new Map<string, FlatRow[]>();
      for (const r of rs) by.set(key(r), [...(by.get(key(r)) ?? []), r]);
      return [...by.entries()];
    };
    if (mode === 'lead') {
      return bucket(rows, (r) => productById(r.entry.productId)?.leadId ?? NO_LEAD)
        .map(([leadId, lrs]) => ({
          id: leadId,
          depth: 3 as const,
          subs: bucket(lrs, (r) => r.entry.productId).map(([pid, prs]) => ({
            id: pid,
            subs: bucket(prs, (r) => r.report.memberId).map(([mid, mrs]) => ({ id: mid, rows: mrs })),
          })),
        }))
        .sort((a, b) =>
          a.id === NO_LEAD ? 1 : b.id === NO_LEAD ? -1 : memberName(a.id).localeCompare(memberName(b.id), 'zh-CN'),
        );
    }
    const outerKey = (r: FlatRow) => (mode === 'product' ? r.entry.productId : r.report.memberId);
    const innerKey = (r: FlatRow) => (mode === 'product' ? r.report.memberId : r.entry.productId);
    return bucket(rows, outerKey)
      .map(([oid, ors]) => ({
        id: oid,
        depth: 2 as const,
        subs: bucket(ors, innerKey).map(([iid, irs]) => ({ id: iid, rows: irs })),
      }))
      .sort((a, b) => (mode === 'product' ? productName(a.id).localeCompare(productName(b.id), 'zh-CN') : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, mode]);

  const onCopy = async () => {
    const text = buildCopyText(date, groups, mode, productName, memberName, t('reports.noLead'));
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const maxTrend = Math.max(1, ...(stats?.trend.map((t) => t.count) ?? [1]));

  return (
    <div className="mx-auto max-w-[860px]">
      {/* 统计条 */}
      {stats && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-surface px-3.5 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-3">今日已提交</div>
            <div className="mt-1 text-[20px] font-bold text-fg-1">
              {stats.todayCount}
              <span className="text-[13px] font-medium text-fg-3"> / {stats.memberCount}</span>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-surface px-3.5 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-3">累计日报</div>
            <div className="mt-1 text-[20px] font-bold text-fg-1">{stats.totalReports}</div>
          </div>
          <div className="rounded-lg border border-border bg-surface px-3.5 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-3">近 7 日</div>
            <div className="mt-1.5 flex h-[22px] items-end gap-1">
              {stats.trend.map((t) => (
                <div key={t.date} className="flex-1 rounded-sm" title={`${t.date}: ${t.count} 份`}
                  style={{ height: `${Math.max(8, (t.count / maxTrend) * 100)}%`, background: t.count ? 'var(--brand-blue)' : 'var(--surface-2)' }} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 未提交提醒(仅看今天时) */}
      {stats && date === today && stats.unsubmitted.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2.5">
          <span className="mr-1 text-[12.5px] font-medium text-fg-3">今日未提交:</span>
          {stats.unsubmitted.map((m) => (
            <span key={m.id} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-[12px] text-fg-2">
              <Avatar person={memberById(m.id) ?? null} size={16} />
              {m.name}
            </span>
          ))}
        </div>
      )}

      {/* 过滤 + 视图切换 + 复制 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={dateInputCls} />
        <FilterMenu
          label={t('reports.filter.product')}
          options={products.filter((p) => p.status !== 'archived')}
          value={productId}
          onChange={setProductId}
        />
        <FilterMenu label={t('reports.filter.member')} options={humans} value={memberId} onChange={setMemberId} />
        <div className="flex-1" />
        <div className="flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
          <SegBtn active={mode === 'product'} onClick={() => setMode('product')}>{t('reports.group.product')}</SegBtn>
          <SegBtn active={mode === 'member'} onClick={() => setMode('member')}>{t('reports.group.member')}</SegBtn>
          <SegBtn active={mode === 'lead'} onClick={() => setMode('lead')}>{t('reports.group.lead')}</SegBtn>
        </div>
        <Button variant="secondary" size="sm" onClick={onCopy} disabled={rows.length === 0}>
          {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
          {copied ? '已复制' : '复制汇总'}
        </Button>
      </div>

      {/* 汇总内容 */}
      {isLoading ? (
        <Skeleton rows={7} />
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong py-14 text-center text-[13px] text-fg-3">
          {date} 暂无日报
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => {
            const outerProduct = mode === 'product' ? productById(g.id) : undefined;
            const outerMember = mode !== 'product' && g.id !== NO_LEAD ? memberById(g.id) : undefined;
            const outerLabel =
              mode === 'product' ? productName(g.id) : g.id === NO_LEAD ? t('reports.noLead') : memberName(g.id);
            return (
              <div key={g.id} className="rounded-lg border border-border bg-surface">
                <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
                  {mode === 'product' ? (
                    <ProductDot product={outerProduct} size={9} />
                  ) : (
                    <Avatar person={outerMember ?? null} size={20} />
                  )}
                  <span className="text-[13.5px] font-semibold text-fg-1">{outerLabel}</span>
                  <span className="text-[12px] text-fg-3">
                    {mode === 'product'
                      ? t('reports.countMembers', { n: g.subs.length })
                      : t('reports.countProducts', { n: g.subs.length })}
                  </span>
                </div>
                <div className="px-3.5 py-2.5">
                  {g.depth === 2
                    ? g.subs.map((s, si) => (
                        <div key={s.id} className={si > 0 ? 'mt-3 border-t border-border pt-3' : ''}>
                          <div className="mb-1.5 flex items-center gap-2">
                            {mode === 'product' ? (
                              <>
                                <Avatar person={memberById(s.id) ?? null} size={18} />
                                <span className="text-[12.5px] font-semibold text-fg-2">{memberName(s.id)}</span>
                              </>
                            ) : (
                              <>
                                <ProductDot product={productById(s.id)} />
                                <span className="text-[12.5px] font-semibold text-fg-2">{productName(s.id)}</span>
                              </>
                            )}
                          </div>
                          <TaskList rows={s.rows} />
                        </div>
                      ))
                    : g.subs.map((p, pi) => (
                        <div key={p.id} className={pi > 0 ? 'mt-3 border-t border-border pt-3' : ''}>
                          <div className="mb-1.5 flex items-center gap-2">
                            <ProductDot product={productById(p.id)} />
                            <span className="text-[12.5px] font-semibold text-fg-2">{productName(p.id)}</span>
                          </div>
                          <div className="flex flex-col gap-2.5 pl-2.5">
                            {p.subs.map((s) => (
                              <div key={s.id}>
                                <div className="mb-1.5 flex items-center gap-2">
                                  <Avatar person={memberById(s.id) ?? null} size={18} />
                                  <span className="text-[12.5px] font-semibold text-fg-2">{memberName(s.id)}</span>
                                </div>
                                <TaskList rows={s.rows} />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function ReportsView() {
  const { can, me, products, humans } = useAppData();
  const t = useT();
  const canWrite = can('reports', 'write');
  const [tab, setTab] = React.useState<'write' | 'summary'>(canWrite ? 'write' : 'summary');

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex-none px-6 pt-5">
        <div className="mx-auto max-w-[860px]">
          <h1 className="text-[17px] font-bold text-fg-1">日报</h1>
          <p className="mb-3 mt-0.5 text-[12.5px] text-fg-3">{t('reports.subtitle')}</p>
          <div className="flex gap-4 border-b border-border">
            {canWrite && <TabBtn active={tab === 'write'} onClick={() => setTab('write')}>写日报</TabBtn>}
            <TabBtn active={tab === 'summary'} onClick={() => setTab('summary')}>日报汇总</TabBtn>
          </div>
        </div>
      </div>
      <div className="flex-1 px-6 py-5">
        {tab === 'write' && canWrite ? (
          <WriteReport me={me} products={products} />
        ) : (
          <ReportsSummary products={products} humans={humans.filter((m) => m.status === 'active')} />
        )}
      </div>
    </div>
  );
}
