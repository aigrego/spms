'use client';

import * as React from 'react';
import { CalendarDays, Check, ChevronDown, ClipboardCopy, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger, MenuItem } from '@/components/ui/popover';
import { SegBtn, TabBtn } from '@/components/ui/segmented';
import { Avatar } from '@/components/glyphs/Avatar';
import { Skeleton } from '@/components/StateBlock';
import { relativeTime } from '@/lib/time';
import { useT } from '@/lib/i18n';
import { useAppData } from '@/store/AppData';
import { useDeleteReport, useMyReport, useReports, useReportStats, useSaveMyReport } from '@/store/reports';
import type { DailyReport, DailyReportEntry, Member, Project } from '@/lib/types';

/* 日报视图 — 「写日报」+「日报汇总」两个页签。
   汇总按 项目 → 人员 → 任务 上卷(对齐负责人统一上报的格式),支持一键复制。
   日期一律用客户端本地时区的 'YYYY-MM-DD'(服务端只做不透明 day key)。 */

function localToday(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const dateInputCls =
  'h-8 rounded-md border border-border-strong bg-surface px-2.5 text-[13px] text-fg-1 outline-none focus:border-brand-blue';

function ProjectDot({ project, size = 8 }: { project?: Project; size?: number }) {
  return (
    <span
      className="inline-block flex-none rounded-full"
      style={{ width: size, height: size, background: project?.color ?? 'var(--fg-3)' }}
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

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/* ------------------------------------------------------------------ */
/* 写日报                                                              */
/* ------------------------------------------------------------------ */

function WriteReport({ me, projects }: { me: Member | undefined; projects: Project[] }) {
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
        <ReportEditor key={date} date={date} initial={existing ?? null} projects={projects} />
      )}
    </div>
  );
}

function ReportEditor({
  date,
  initial,
  projects,
}: {
  date: string;
  initial: DailyReport | null;
  projects: Project[];
}) {
  const [blocks, setBlocks] = React.useState<{ projectId: string; content: string }[]>(() =>
    initial ? initial.entries.map((e) => ({ projectId: e.projectId, content: e.content })) : [],
  );
  // 保存后拿到的 report id(首存前 initial 为 null),用于删除与按钮文案。
  const [reportId, setReportId] = React.useState<string | null>(initial?.id ?? null);
  // 保存成功时的快照,用于 dirty 判断;不随服务端 refetch 漂移。
  const snapshotOf = (bs: { projectId: string; content: string }[]) =>
    JSON.stringify(bs.map((b) => ({ p: b.projectId, c: b.content.trim() })).filter((b) => b.c));
  const [savedSnapshot, setSavedSnapshot] = React.useState(() => snapshotOf(blocks));
  const [feedback, setFeedback] = React.useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const save = useSaveMyReport();
  const del = useDeleteReport();

  const activeProjects = projects.filter((p) => !p.archivedAt);
  const usedIds = new Set(blocks.map((b) => b.projectId));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const toggleProject = (id: string) => {
    setBlocks((prev) =>
      prev.some((b) => b.projectId === id) ? prev.filter((b) => b.projectId !== id) : [...prev, { projectId: id, content: '' }],
    );
  };

  const dirty = snapshotOf(blocks) !== savedSnapshot;
  const canSave = dirty && blocks.some((b) => b.content.trim()) && !save.isPending;

  const onSave = async () => {
    setFeedback(null);
    const entries = blocks.map((b) => ({ projectId: b.projectId, content: b.content })).filter((b) => b.content.trim());
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

      {/* 项目选择 */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {activeProjects.map((p) => {
          const used = usedIds.has(p.id);
          return (
            <button
              key={p.id}
              onClick={() => toggleProject(p.id)}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-medium transition-colors"
              style={{
                borderColor: used ? 'var(--brand-blue)' : 'var(--border-strong)',
                background: used ? 'var(--brand-blue-tint-8, var(--surface-2))' : 'var(--surface)',
                color: used ? 'var(--brand-blue)' : 'var(--fg-2)',
              }}
            >
              <ProjectDot project={p} />
              {p.name}
              {used ? <Check size={12} /> : <Plus size={12} className="text-fg-3" />}
            </button>
          );
        })}
        {activeProjects.length === 0 && <span className="text-[12.5px] text-fg-3">暂无进行中的项目</span>}
      </div>

      {/* 内容块 */}
      {blocks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong py-14 text-center text-[13px] text-fg-3">
          点击上方项目,为 {date} 添加工作内容
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {blocks.map((b) => {
            const p = projectById.get(b.projectId);
            return (
              <div key={b.projectId} className="rounded-lg border border-border bg-surface">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <ProjectDot project={p} />
                  <span className="text-[13px] font-semibold text-fg-1">{p?.name ?? '未知项目'}</span>
                  <div className="flex-1" />
                  <button
                    onClick={() => toggleProject(b.projectId)}
                    className="rounded p-0.5 text-fg-3 hover:bg-surface-2 hover:text-fg-1"
                    title="移除该项目"
                  >
                    <X size={14} />
                  </button>
                </div>
                <Textarea
                  rows={4}
                  value={b.content}
                  onChange={(e) =>
                    setBlocks((prev) => prev.map((x) => (x.projectId === b.projectId ? { ...x, content: e.target.value } : x)))
                  }
                  placeholder={'该项目当天做了什么…每行一条'}
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
/* 日报汇总(项目 → 人员 → 任务)                                         */
/* ------------------------------------------------------------------ */

type FlatRow = { report: DailyReport; entry: DailyReportEntry };

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

/* 汇总文本(对齐向上上报格式):
   31/7/2026 工作总结:
   OX:
   1. SJZ:
   a. xxx
   b. xxx */
function buildCopyText(date: string, rows: FlatRow[], projectName: (id: string) => string, memberName: (id: string) => string): string {
  const [y, m, d] = date.split('-').map(Number);
  const out: string[] = [`${d}/${m}/${y} 工作总结:`, ''];
  const byProject = new Map<string, FlatRow[]>();
  for (const r of rows) {
    const list = byProject.get(r.entry.projectId) ?? [];
    list.push(r);
    byProject.set(r.entry.projectId, list);
  }
  for (const [pid, projectRows] of byProject) {
    out.push(`${projectName(pid)}:`);
    const byMember = new Map<string, FlatRow[]>();
    for (const r of projectRows) {
      const list = byMember.get(r.report.memberId) ?? [];
      list.push(r);
      byMember.set(r.report.memberId, list);
    }
    let mi = 0;
    for (const [mid, memberRows] of byMember) {
      mi += 1;
      out.push(`${mi}. ${memberName(mid)}:`);
      const tasks = memberRows.flatMap((r) => toTaskLines(r.entry.content));
      tasks.forEach((task, ti) => out.push(`${LETTERS[ti % 26]}. ${task}`));
      out.push('');
    }
  }
  return out.join('\n');
}

function ReportsSummary({ projects, humans }: { projects: Project[]; humans: Member[] }) {
  const today = localToday();
  const [date, setDate] = React.useState(today);
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [memberId, setMemberId] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<'project' | 'member'>('project');
  const [copied, setCopied] = React.useState(false);

  const { data: stats } = useReportStats(today);
  const { data: reports, isLoading } = useReports({
    startDate: date,
    endDate: date,
    projectId: projectId ?? undefined,
    memberId: memberId ?? undefined,
  });

  const { projectById, memberById } = useAppData();
  const projectName = (id: string) => projectById(id)?.name ?? '未知项目';
  const memberName = (id: string) => memberById(id)?.name ?? '未知成员';

  const rows: FlatRow[] = React.useMemo(
    () => (reports ?? []).flatMap((report) => report.entries.map((entry) => ({ report, entry }))),
    [reports],
  );

  const onCopy = async () => {
    const text = buildCopyText(date, rows, projectName, memberName);
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

  /* 分组:按项目(项目 → 人员 → 任务) 或 按人员(人员 → 项目 → 任务)。 */
  const groups = React.useMemo(() => {
    const outerKey = (r: FlatRow) => (mode === 'project' ? r.entry.projectId : r.report.memberId);
    const innerKey = (r: FlatRow) => (mode === 'project' ? r.report.memberId : r.entry.projectId);
    const byOuter = new Map<string, FlatRow[]>();
    for (const r of rows) {
      const k = outerKey(r);
      byOuter.set(k, [...(byOuter.get(k) ?? []), r]);
    }
    return [...byOuter.entries()]
      .map(([oid, ors]) => {
        const byInner = new Map<string, FlatRow[]>();
        for (const r of ors) {
          const k = innerKey(r);
          byInner.set(k, [...(byInner.get(k) ?? []), r]);
        }
        return { id: oid, subs: [...byInner.entries()].map(([iid, irs]) => ({ id: iid, rows: irs })) };
      })
      .sort((a, b) => (mode === 'project' ? projectName(a.id).localeCompare(projectName(b.id), 'zh-CN') : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, mode]);

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
        <FilterMenu label="项目" options={projects.filter((p) => !p.archivedAt)} value={projectId} onChange={setProjectId} />
        <FilterMenu label="成员" options={humans} value={memberId} onChange={setMemberId} />
        <div className="flex-1" />
        <div className="flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
          <SegBtn active={mode === 'project'} onClick={() => setMode('project')}>按项目</SegBtn>
          <SegBtn active={mode === 'member'} onClick={() => setMode('member')}>按人员</SegBtn>
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
            const outerProject = mode === 'project' ? projectById(g.id) : undefined;
            const outerMember = mode === 'member' ? memberById(g.id) : undefined;
            return (
              <div key={g.id} className="rounded-lg border border-border bg-surface">
                <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
                  {mode === 'project' ? (
                    <>
                      <ProjectDot project={outerProject} size={9} />
                      <span className="text-[13.5px] font-semibold text-fg-1">{projectName(g.id)}</span>
                    </>
                  ) : (
                    <>
                      <Avatar person={outerMember ?? null} size={20} />
                      <span className="text-[13.5px] font-semibold text-fg-1">{memberName(g.id)}</span>
                    </>
                  )}
                  <span className="text-[12px] text-fg-3">{g.subs.length} {mode === 'project' ? '人' : '个项目'}</span>
                </div>
                <div className="px-3.5 py-2.5">
                  {g.subs.map((s, si) => {
                    const subMember = mode === 'project' ? memberById(s.id) : undefined;
                    const subProject = mode === 'member' ? projectById(s.id) : undefined;
                    const tasks = s.rows.flatMap((r) => toTaskLines(r.entry.content));
                    return (
                      <div key={s.id} className={si > 0 ? 'mt-3 border-t border-border pt-3' : ''}>
                        <div className="mb-1.5 flex items-center gap-2">
                          {mode === 'project' ? (
                            <>
                              <Avatar person={subMember ?? null} size={18} />
                              <span className="text-[12.5px] font-semibold text-fg-2">{memberName(s.id)}</span>
                            </>
                          ) : (
                            <>
                              <ProjectDot project={subProject} />
                              <span className="text-[12.5px] font-semibold text-fg-2">{projectName(s.id)}</span>
                            </>
                          )}
                        </div>
                        <ul className="flex flex-col gap-1 pl-1">
                          {tasks.map((task, ti) => (
                            <li key={ti} className="flex gap-2 text-[13px] leading-relaxed text-fg-1">
                              <span className="flex-none text-fg-3">{LETTERS[ti % 26]}.</span>
                              <span>{task}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
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
  const { can, me, projects, humans } = useAppData();
  const canWrite = can('reports', 'write');
  const [tab, setTab] = React.useState<'write' | 'summary'>(canWrite ? 'write' : 'summary');

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex-none px-6 pt-5">
        <div className="mx-auto max-w-[860px]">
          <h1 className="text-[17px] font-bold text-fg-1">日报</h1>
          <p className="mb-3 mt-0.5 text-[12.5px] text-fg-3">按项目记录每日工作,自动汇总上报</p>
          <div className="flex gap-4 border-b border-border">
            {canWrite && <TabBtn active={tab === 'write'} onClick={() => setTab('write')}>写日报</TabBtn>}
            <TabBtn active={tab === 'summary'} onClick={() => setTab('summary')}>日报汇总</TabBtn>
          </div>
        </div>
      </div>
      <div className="flex-1 px-6 py-5">
        {tab === 'write' && canWrite ? (
          <WriteReport me={me} projects={projects} />
        ) : (
          <ReportsSummary projects={projects} humans={humans.filter((m) => m.status === 'active')} />
        )}
      </div>
    </div>
  );
}
