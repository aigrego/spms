'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { SegBtn } from '@/components/ui/segmented';
import { Popover, PopoverContent, PopoverTrigger, MenuItem } from '@/components/ui/popover';
import { Avatar } from '@/components/glyphs/Avatar';
import { Skeleton } from '@/components/StateBlock';
import { STATUS } from '@/lib/constants';
import { formatDate } from '@/lib/time';
import { useLocale, useT } from '@/lib/i18n';
import { useAppData } from '@/store/AppData';
import { useTeamSummary } from '@/store/summary';
import type {
  IssueStatus,
  RequirementStatus,
  SummaryBucket,
  SummaryDurationStat,
  SummaryMemberRow,
  SummaryMetric,
} from '@/lib/types';

/* 团队总结 (TKT-33) — 每日/每周两个页签的周期统计:吞吐、周期时长、验收积压、
   流动健康与按成员分列。统计口径见 src/server/services/summary.ts 文件头。
   日期一律用客户端本地时区的 'YYYY-MM-DD' day key(服务端只做边界换算)。 */

function localToday(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDay(day: string, offset: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function weekMonday(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return shiftDay(day, -((dow + 6) % 7));
}

/* 'YYYY-MM-DD' → 'M/D'(不经过 Date,避免时区漂移)。 */
function dayLabel(day: string): string {
  const [, m, d] = day.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/* ------------------------------------------------------------------ */
/* 小组件                                                              */
/* ------------------------------------------------------------------ */

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
  const t = useT();
  const current = options.find((o) => o.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 text-[13px] text-fg-2 hover:bg-surface-2">
          <span className="text-fg-3">{label}</span>
          <span className="max-w-[140px] truncate font-medium text-fg-1">{current?.name ?? t('common.all')}</span>
          <ChevronDown size={13} className="text-fg-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[320px] w-[200px] overflow-y-auto">
        <MenuItem label={t('common.all')} selected={value === null} onClick={() => { onChange(null); setOpen(false); }} />
        {options.map((o) => (
          <MenuItem key={o.id} label={o.name} selected={o.id === value} onClick={() => { onChange(o.id); setOpen(false); }} />
        ))}
      </PopoverContent>
    </Popover>
  );
}

function Card({ title, sub, badge, children }: { title: string; sub?: string; badge?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface px-4 py-3.5">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-[14px] font-bold text-fg-1">{title}</h2>
        {badge && (
          <span className="rounded-full bg-surface-2 px-2 py-px text-[11px] font-medium text-fg-3">{badge}</span>
        )}
      </div>
      {sub && <p className="-mt-2 mb-3 text-[12px] leading-relaxed text-fg-3">{sub}</p>}
      {children}
    </section>
  );
}

/* 指标行:大数字 + 与上一同长周期的差值(±n,prev>0 时附百分比)。 */
function Metric({ label, m, invert }: { label: string; m: SummaryMetric; invert?: boolean }) {
  const delta = m.value - m.prev;
  const pct = m.prev > 0 ? Math.round((delta / m.prev) * 100) : null;
  const good = invert ? delta < 0 : delta > 0;
  const bad = invert ? delta > 0 : delta < 0;
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <span className="text-[12.5px] text-fg-3">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-[20px] font-bold leading-none text-fg-1">{m.value}</span>
        {delta !== 0 && (
          <span
            className="text-[11px] font-medium"
            style={{ color: good ? 'var(--success-500)' : bad ? 'var(--danger-500)' : 'var(--fg-3)' }}
          >
            {delta > 0 ? `+${delta}` : delta}
            {pct != null && ` · ${pct > 0 ? `+${pct}` : pct}%`}
          </span>
        )}
      </span>
    </div>
  );
}

/* 时长:>=1 天按天,>=1 小时按小时,否则分钟(与竞品「2.3 天 / 41.5 小时」一致)。 */
function useFmtDuration() {
  const t = useT();
  return (ms: number | null): string => {
    if (ms == null) return '—';
    const min = ms / 60_000;
    if (min < 1) return t('summary.dur.justNow');
    if (min < 60) return t('summary.dur.minute', { n: Math.round(min) });
    const hr = min / 60;
    if (hr < 24) return t('summary.dur.hour', { n: Math.round(hr * 10) / 10 });
    return t('summary.dur.day', { n: Math.round((hr / 24) * 10) / 10 });
  };
}

/* ------------------------------------------------------------------ */
/* 吞吐图(纯 SVG:需求/ Issue 新建双柱 + 交付实线 + 验收虚线)           */
/* ------------------------------------------------------------------ */

const C_REQ = '#7C5CFC';
const C_ISSUE = '#12A594';
const C_DELIVERED = '#0063D3';
const C_ACCEPTED = '#1F9D55';

function ThroughputChart({ buckets, weekly }: { buckets: SummaryBucket[]; weekly?: boolean }) {
  const t = useT();
  const n = buckets.length;
  const W = Math.max(n * 56 + 50, 320);
  const H = 220;
  const pad = { t: 14, r: 12, b: 26, l: 30 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const maxY = Math.max(2, ...buckets.map((b) => Math.max(b.reqCreated, b.issueCreated, b.delivered, b.accepted)));
  const x = (i: number) => pad.l + (innerW * (i + 0.5)) / n;
  const y = (v: number) => pad.t + innerH - (innerH * v) / maxY;
  const ticks = [...new Set([0, 0.5, 1].map((f) => Math.round(maxY * f)))];
  const line = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ');
  // 标签间隔:14 天隔 2、12 周隔 2、7 天全标。
  const labelEvery = n > 10 ? 2 : 1;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 260 }}>
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={pad.l} y1={y(tv)} x2={W - pad.r} y2={y(tv)} stroke="var(--border)" strokeWidth="1" />
            <text x={pad.l - 6} y={y(tv) + 3} textAnchor="end" fontSize="9" fill="var(--fg-3)">
              {tv}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => (
          <g key={b.date}>
            <rect x={x(i) - 15} y={y(b.reqCreated)} width="13" height={Math.max(0, pad.t + innerH - y(b.reqCreated))} rx="2" fill={C_REQ}>
              <title>{`${b.date} · ${t('summary.legend.reqCreated')}: ${b.reqCreated}`}</title>
            </rect>
            <rect x={x(i) + 2} y={y(b.issueCreated)} width="13" height={Math.max(0, pad.t + innerH - y(b.issueCreated))} rx="2" fill={C_ISSUE}>
              <title>{`${b.date} · ${t('summary.legend.issueCreated')}: ${b.issueCreated}`}</title>
            </rect>
            {i % labelEvery === 0 && (
              <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="var(--fg-3)">
                {dayLabel(b.date)}
                {weekly && <title>{b.date}</title>}
              </text>
            )}
          </g>
        ))}
        <path d={line(buckets.map((b) => b.delivered))} fill="none" stroke={C_DELIVERED} strokeWidth="2" strokeLinejoin="round" />
        <path d={line(buckets.map((b) => b.accepted))} fill="none" stroke={C_ACCEPTED} strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" />
        {buckets.map((b, i) => (
          <g key={`${b.date}-pts`}>
            <circle cx={x(i)} cy={y(b.delivered)} r="2.5" fill={C_DELIVERED}>
              <title>{`${b.date} · ${t('summary.legend.delivered')}: ${b.delivered}`}</title>
            </circle>
            <circle cx={x(i)} cy={y(b.accepted)} r="2.5" fill={C_ACCEPTED}>
              <title>{`${b.date} · ${t('summary.legend.accepted')}: ${b.accepted}`}</title>
            </circle>
          </g>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-4 px-1 text-[11px] text-fg-3">
        {[
          { c: C_REQ, k: 'summary.legend.reqCreated' },
          { c: C_ISSUE, k: 'summary.legend.issueCreated' },
          { c: C_DELIVERED, k: 'summary.legend.delivered' },
          { c: C_ACCEPTED, k: 'summary.legend.accepted' },
        ].map((l) => (
          <span key={l.k} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: l.c }} />
            {t(l.k)}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 周期时长:三段各一行(平均填充 + P90/最长刻度)                         */
/* ------------------------------------------------------------------ */

function CycleRow({
  label,
  sub,
  stat,
  scale,
  color,
}: {
  label: string;
  sub: string;
  stat: SummaryDurationStat;
  scale: number;
  color: string;
}) {
  const t = useT();
  const fmt = useFmtDuration();
  const pct = (ms: number | null) => (ms == null ? 0 : Math.min(100, (ms / scale) * 100));
  return (
    <div className="py-2">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-semibold text-fg-1">{label}</span>
        <span className="text-[11.5px] text-fg-3">{sub}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <div className="relative h-2 flex-1 rounded-full" style={{ background: 'var(--surface-sunken)' }}>
          {stat.avgMs != null && (
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct(stat.avgMs)}%`, background: color }} />
          )}
          {stat.p90Ms != null && (
            <div className="absolute top-[-3px] h-3.5 w-px" style={{ left: `${pct(stat.p90Ms)}%`, background: 'var(--fg-3)' }} />
          )}
          {stat.maxMs != null && (
            <div className="absolute top-[-3px] h-3.5 w-[2px]" style={{ left: `calc(${pct(stat.maxMs)}% - 1px)`, background: 'var(--fg-1)' }} />
          )}
        </div>
        <div className="flex flex-none items-baseline gap-3 text-[12px] text-fg-2">
          <span>
            <span className="text-fg-3">{t('summary.stat.avg')} </span>
            <span className="font-semibold text-fg-1">{fmt(stat.avgMs)}</span>
          </span>
          <span>
            <span className="text-fg-3">{t('summary.stat.p90')} </span>
            <span className="font-semibold text-fg-1">{fmt(stat.p90Ms)}</span>
          </span>
          <span>
            <span className="text-fg-3">{t('summary.stat.max')} </span>
            <span className="font-semibold text-fg-1">{fmt(stat.maxMs)}</span>
          </span>
          {stat.maxKey && (
            <Link href={`/issues/${stat.maxKey}`} className="font-mono text-[11px] text-brand-blue hover:underline">
              {stat.maxKey}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 状态分布横条(Issue / 需求)                                          */
/* ------------------------------------------------------------------ */

const REQ_STATUS_COLOR: Record<RequirementStatus, string> = {
  draft: '#8E99B0',
  reviewing: '#D89400',
  approved: '#0063D3',
  in_dev: '#FF8423',
  shipped: '#1F9D55',
  rejected: '#D6293E',
};

function DistBar<T extends string>({
  counts,
  colorOf,
  labelOf,
}: {
  counts: Record<T, number>;
  colorOf: (k: T) => string;
  labelOf: (k: T) => string;
}) {
  const entries = (Object.entries(counts) as [T, number][]).filter(([, v]) => v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface-sunken)' }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ width: `${(v / Math.max(1, total)) * 100}%`, background: colorOf(k) }} title={`${labelOf(k)}: ${v}`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-fg-3">
        {entries.map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: colorOf(k) }} />
            {labelOf(k)} <span className="font-semibold text-fg-2">{v}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 按成员表格(点击列头排序,默认交付降序)                               */
/* ------------------------------------------------------------------ */

type MemberSortKey = 'created' | 'delivered' | 'accepted' | 'avgDeliveryMs' | 'points' | 'wip' | 'pendingAcceptance';

function MembersTable({ rows }: { rows: SummaryMemberRow[] }) {
  const t = useT();
  const { memberById, meId } = useAppData();
  const fmt = useFmtDuration();
  const [sort, setSort] = React.useState<{ key: MemberSortKey | null; desc: boolean }>({ key: 'delivered', desc: true });

  const cols: { key: MemberSortKey | null; label: string }[] = [
    { key: null, label: t('summary.col.name') },
    { key: 'created', label: t('summary.col.created') },
    { key: 'delivered', label: t('summary.col.delivered') },
    { key: 'accepted', label: t('summary.col.accepted') },
    { key: 'avgDeliveryMs', label: t('summary.col.avgDelivery') },
    { key: 'points', label: t('summary.col.points') },
    { key: 'wip', label: t('summary.col.wip') },
    { key: 'pendingAcceptance', label: t('summary.col.pending') },
  ];

  const sorted = React.useMemo(() => {
    if (!sort.key) return rows;
    const k = sort.key;
    return [...rows].sort((a, b) => {
      const av = a[k] ?? -1;
      const bv = b[k] ?? -1;
      return sort.desc ? bv - av : av - bv;
    });
  }, [rows, sort]);

  const toggle = (key: MemberSortKey | null) => {
    if (!key) return;
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }));
  };

  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="border-b border-border text-left">
          {cols.map((c, i) => (
            <th
              key={c.label}
              onClick={() => toggle(c.key)}
              className={`px-3 py-2 text-[12px] font-semibold text-fg-3 ${i > 0 ? 'text-right' : ''} ${c.key ? 'cursor-pointer select-none hover:text-fg-1' : ''}`}
            >
              <span className={sort.key === c.key ? 'text-brand-blue' : undefined}>
                {c.label}
                {sort.key === c.key && (sort.desc ? ' ↓' : ' ↑')}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => {
          const m = memberById(r.memberId);
          return (
            <tr key={r.memberId} className="border-b border-border last:border-0 hover:bg-surface-2">
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  <Avatar person={m ?? null} size={20} />
                  <span className="font-medium text-fg-1">{m?.name ?? r.memberId}</span>
                  {r.memberId === meId && (
                    <span
                      className="rounded px-1 py-px text-[10.5px] font-semibold text-brand-blue"
                      style={{ background: 'var(--brand-blue-tint-8)' }}
                    >
                      {t('summary.you')}
                    </span>
                  )}
                </span>
              </td>
              <td className="px-3 py-2 text-right text-fg-2">{r.created}</td>
              <td className="px-3 py-2 text-right text-fg-2">{r.delivered}</td>
              <td className="px-3 py-2 text-right text-fg-2">{r.accepted}</td>
              <td className="px-3 py-2 text-right text-fg-2">{fmt(r.avgDeliveryMs)}</td>
              <td className="px-3 py-2 text-right text-fg-2">{r.points}</td>
              <td className="px-3 py-2 text-right text-fg-2">{r.wip}</td>
              <td className="px-3 py-2 text-right text-fg-2">{r.pendingAcceptance}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ */
/* 主视图                                                              */
/* ------------------------------------------------------------------ */

export function SummaryView() {
  const t = useT();
  const locale = useLocale();
  const fmt = useFmtDuration();
  const { members, projects, can } = useAppData();
  const [period, setPeriod] = React.useState<'daily' | 'weekly'>('daily');
  const [date, setDate] = React.useState(localToday);
  const [memberId, setMemberId] = React.useState<string | null>(null);
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const tzMin = -new Date().getTimezoneOffset();

  const { data, isLoading } = useTeamSummary({ period, date, tzMin, memberId, projectId });

  const today = localToday();
  const start = data?.period.start ?? (period === 'weekly' ? weekMonday(date) : date);
  const end = data?.period.end ?? date;
  const ongoing = today >= start && today <= end;
  const step = period === 'weekly' ? 7 : 1;
  const canNext = shiftDay(date, step) <= today;

  if (!can('reports', 'read')) {
    return <div className="px-6 py-16 text-center text-[13px] text-fg-3">{t('summary.empty')}</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* 头部:标题 + 周期切换 + 日期导航 + 过滤器 */}
      <div className="flex-none px-6 pt-5">
        <div className="mx-auto max-w-[1100px]">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-col">
              <h1 className="text-[17px] font-bold text-fg-1">{t('summary.title')}</h1>
              <p className="mt-0.5 text-[12.5px] text-fg-3">
                {period === 'weekly' ? `${start} ~ ${end}` : start}
                {ongoing && (
                  <span
                    className="ml-2 rounded-full px-2 py-px text-[11px] font-semibold text-brand-blue"
                    style={{ background: 'var(--brand-blue-tint-8)' }}
                  >
                    {t('summary.ongoing')}
                  </span>
                )}
              </p>
            </div>
            <div className="ml-2 flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
              <SegBtn active={period === 'daily'} onClick={() => setPeriod('daily')}>{t('summary.tab.daily')}</SegBtn>
              <SegBtn active={period === 'weekly'} onClick={() => setPeriod('weekly')}>{t('summary.tab.weekly')}</SegBtn>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setDate(shiftDay(date, -step))}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-strong bg-surface text-fg-2 hover:bg-surface-2"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setDate(today)}
                disabled={date === today}
                className="inline-flex h-7 items-center rounded-md border border-border-strong bg-surface px-2 text-[12px] font-medium text-fg-2 hover:bg-surface-2 disabled:opacity-50"
              >
                {period === 'weekly' ? t('summary.backWeek') : t('summary.backToday')}
              </button>
              <button
                onClick={() => canNext && setDate(shiftDay(date, step))}
                disabled={!canNext}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-strong bg-surface text-fg-2 hover:bg-surface-2 disabled:opacity-50"
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="flex-1" />
            <FilterMenu
              label={t('summary.filter.member')}
              options={members.filter((m) => m.status === 'active')}
              value={memberId}
              onChange={setMemberId}
            />
            <FilterMenu
              label={t('summary.filter.project')}
              options={projects.filter((p) => !p.archivedAt).map((p) => ({ id: p.id, name: p.name }))}
              value={projectId}
              onChange={setProjectId}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 px-6 py-4">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-4 pb-8">
          {isLoading || !data ? (
            <Skeleton rows={9} />
          ) : (
            <>
              {data.flowSince && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3.5 py-2 text-[12.5px] text-fg-3">
                  <Info size={14} className="flex-none" />
                  {t('summary.flowSince', { date: formatDate(data.flowSince, locale) })}
                </div>
              )}

              {/* 指标卡:需求 / Issue / 测试 */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card title={t('summary.card.requirements')}>
                  <Metric label={t('summary.m.created')} m={data.cards.reqCreated} />
                </Card>
                <Card title={t('summary.card.issues')}>
                  <Metric label={t('summary.m.created')} m={data.cards.issueCreated} />
                  <Metric label={t('summary.m.delivered')} m={data.cards.delivered} />
                  <Metric label={t('summary.m.accepted')} m={data.cards.accepted} />
                  <Metric label={t('summary.m.rejected')} m={data.cards.rejected} invert />
                  <Metric label={t('summary.m.reopened')} m={data.cards.reopened} invert />
                </Card>
                <Card title={t('summary.card.tests')}>
                  <Metric label={t('summary.m.tcCreated')} m={data.cards.tcCreated} />
                </Card>
              </div>

              {/* 吞吐 */}
              <Card
                title={t('summary.throughput.title')}
                sub={period === 'weekly' ? t('summary.throughput.weeklySub') : t('summary.throughput.dailySub')}
              >
                <ThroughputChart buckets={data.throughput} />
              </Card>

              {period === 'weekly' && data.weeklyTrend.length > 0 && (
                <Card title={t('summary.weeklyTrend.title')} sub={t('summary.weeklyTrend.sub')}>
                  <ThroughputChart buckets={data.weeklyTrend} weekly />
                </Card>
              )}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* 周期时长 */}
                <Card title={t('summary.cycle.title')} sub={t('summary.cycle.sub')}>
                  {data.cycleTime.delivery.count === 0 && data.cycleTime.acceptance.count === 0 && data.cycleTime.e2e.count === 0 ? (
                    <p className="py-6 text-center text-[12.5px] text-fg-3">{t('summary.cycle.empty')}</p>
                  ) : (
                    <div className="flex flex-col divide-y divide-border">
                      <CycleRow
                        label={t('summary.cycle.delivery')}
                        sub={t('summary.cycle.deliverySub')}
                        stat={data.cycleTime.delivery}
                        scale={Math.max(data.cycleTime.delivery.maxMs ?? 0, data.cycleTime.acceptance.maxMs ?? 0, data.cycleTime.e2e.maxMs ?? 0, 1)}
                        color={C_DELIVERED}
                      />
                      <CycleRow
                        label={t('summary.cycle.acceptance')}
                        sub={t('summary.cycle.acceptanceSub')}
                        stat={data.cycleTime.acceptance}
                        scale={Math.max(data.cycleTime.delivery.maxMs ?? 0, data.cycleTime.acceptance.maxMs ?? 0, data.cycleTime.e2e.maxMs ?? 0, 1)}
                        color={C_ACCEPTED}
                      />
                      <CycleRow
                        label={t('summary.cycle.e2e')}
                        sub={t('summary.cycle.e2eSub')}
                        stat={data.cycleTime.e2e}
                        scale={Math.max(data.cycleTime.delivery.maxMs ?? 0, data.cycleTime.acceptance.maxMs ?? 0, data.cycleTime.e2e.maxMs ?? 0, 1)}
                        color="#8E99B0"
                      />
                    </div>
                  )}
                </Card>

                {/* 验收积压 */}
                <Card title={t('summary.backlog.title')} sub={t('summary.backlog.sub')}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[28px] font-bold leading-none" style={{ color: data.acceptanceBacklog.count > 0 ? 'var(--danger-500)' : 'var(--fg-1)' }}>
                      {data.acceptanceBacklog.count}
                    </span>
                    <span className="text-[12.5px] text-fg-3">{t('summary.backlog.count')}</span>
                  </div>
                  <div className="mt-3 flex gap-8">
                    <div>
                      <div className="text-[11.5px] text-fg-3">{t('summary.backlog.avgWait')}</div>
                      <div className="mt-0.5 text-[15px] font-semibold text-fg-1">{fmt(data.acceptanceBacklog.avgWaitMs)}</div>
                    </div>
                    <div>
                      <div className="text-[11.5px] text-fg-3">{t('summary.backlog.maxWait')}</div>
                      <div className="mt-0.5 text-[15px] font-semibold text-fg-1">
                        {fmt(data.acceptanceBacklog.maxWaitMs)}
                        {data.acceptanceBacklog.maxKey && (
                          <Link href={`/issues/${data.acceptanceBacklog.maxKey}`} className="ml-1.5 font-mono text-[11px] font-normal text-brand-blue hover:underline">
                            {data.acceptanceBacklog.maxKey}
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              </div>

              {/* 当前流动健康 */}
              <Card title={t('summary.flow.title')} sub={t('summary.flow.sub')}>
                <div className="flex flex-col gap-4">
                  <div>
                    <div className="mb-1.5 text-[12px] font-semibold text-fg-2">{t('summary.flow.issueStatus')}</div>
                    <DistBar<IssueStatus> counts={data.flowHealth.issueStatus} colorOf={(k) => STATUS[k].color} labelOf={(k) => t(`status.${k}`)} />
                  </div>
                  <div>
                    <div className="mb-1.5 text-[12px] font-semibold text-fg-2">{t('summary.flow.reqStatus')}</div>
                    <DistBar<RequirementStatus> counts={data.flowHealth.requirementStatus} colorOf={(k) => REQ_STATUS_COLOR[k]} labelOf={(k) => t(`reqStatus.${k}`)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
                    {[
                      { k: 'summary.flow.wip', v: data.flowHealth.wip, c: 'var(--fg-1)' },
                      { k: 'summary.flow.overdue', v: data.flowHealth.overdue, c: data.flowHealth.overdue > 0 ? 'var(--danger-500)' : 'var(--fg-1)' },
                      { k: 'summary.flow.unassigned', v: data.flowHealth.unassigned, c: data.flowHealth.unassigned > 0 ? 'var(--brand-orange)' : 'var(--fg-1)' },
                      { k: 'summary.flow.stalled', v: data.flowHealth.stalled, c: data.flowHealth.stalled > 0 ? 'var(--brand-orange)' : 'var(--fg-1)' },
                    ].map((s) => (
                      <div key={s.k}>
                        <div className="text-[11.5px] text-fg-3">{t(s.k)}</div>
                        <div className="mt-0.5 text-[18px] font-bold" style={{ color: s.c }}>{s.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>

              {/* 按成员 */}
              <Card title={t('summary.members.title')} sub={t('summary.members.sub')}>
                <MembersTable rows={data.members} />
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
