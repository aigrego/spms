'use client';

import * as React from 'react';
import { X, Trash2, FlaskConical, Search, Link2, CircleDot, Plus } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/glyphs/Avatar';
import { PriorityIcon } from '@/components/glyphs/PriorityIcon';
import { PriorityMenu } from '@/components/menus';
import { Popover, PopoverContent, PopoverTrigger, MenuItem } from '@/components/ui/popover';
import { SegBtn } from '@/components/ui/segmented';
import { InlineCreateRow, EditableTitle } from '@/components/inline';
import { TEST_CASE_STATUS, TEST_CASE_STATUS_ORDER, TEST_RESULT, TEST_RESULT_ORDER, PRIORITY_ORDER } from '@/lib/constants';
import { useT } from '@/lib/i18n';
import { useAppData } from '@/store/AppData';
import { useAllRequirements } from '@/store/requirements';
import { useTestCases, useTestCase, useCreateTestCase, useUpdateTestCase, useDeleteTestCase } from '@/store/testcases';
import { ApiError } from '@/lib/api';
import type { TestCase, TestResult, TestCaseStatus, IssuePriority } from '@/lib/types';

const inputCls =
  'h-9 w-full rounded-lg border border-border-strong bg-surface px-2.5 text-[13px] text-fg-1 outline-none focus:border-brand-blue';
const fieldLabel = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-3';
const selCls =
  'w-full rounded-[7px] border border-transparent bg-transparent px-2 py-1 text-[13px] text-fg-1 hover:bg-surface-2 focus:border-brand-blue focus:bg-surface outline-none';

function ResultDot({ result, size = 9 }: { result: TestResult; size?: number }) {
  return <span className="inline-block flex-none rounded-full" style={{ width: size, height: size, background: TEST_RESULT[result].color }} />;
}

/* Quick-change the last-run result from the list without opening the drawer. */
function ResultMenu({ value, onPick }: { value: TestResult; onPick: (r: TestResult) => void }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button onClick={(e) => e.stopPropagation()}>
          <Badge tone={TEST_RESULT[value].tone}>
            <ResultDot result={value} size={7} /> {t(`tcResult.${value}`)}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[150px]" onClick={(e) => e.stopPropagation()}>
        {TEST_RESULT_ORDER.map((r) => (
          <MenuItem
            key={r}
            glyph={<ResultDot result={r} />}
            label={t(`tcResult.${r}`)}
            selected={r === value}
            onClick={() => {
              onPick(r);
              setOpen(false);
            }}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}

function StatusMenu({ value, onPick }: { value: TestCaseStatus; onPick: (s: TestCaseStatus) => void }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button onClick={(e) => e.stopPropagation()}>
          <Badge tone={TEST_CASE_STATUS[value].tone} dot>
            {t(`tcStatus.${value}`)}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[140px]" onClick={(e) => e.stopPropagation()}>
        {TEST_CASE_STATUS_ORDER.map((s) => (
          <MenuItem key={s} label={t(`tcStatus.${s}`)} selected={s === value} onClick={() => { onPick(s); setOpen(false); }} />
        ))}
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Detail drawer                                                       */
/* ------------------------------------------------------------------ */
function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[30px] items-center gap-2.5">
      <span className="w-[64px] flex-none text-[12.5px] text-fg-3">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function TestCaseDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const { projectById, memberById, humans, agents } = useAppData();
  const { data: tc } = useTestCase(id);
  const { data: reqs = [] } = useAllRequirements();
  const update = useUpdateTestCase();
  const del = useDeleteTestCase();

  const [steps, setSteps] = React.useState('');
  const [expected, setExpected] = React.useState('');
  const [preconditions, setPreconditions] = React.useState('');
  React.useEffect(() => {
    if (tc) {
      setSteps(tc.steps ?? '');
      setExpected(tc.expected ?? '');
      setPreconditions(tc.preconditions ?? '');
    }
  }, [tc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  if (!tc) return null;
  const patch = (input: Parameters<typeof update.mutate>[0]['input']) => update.mutate({ id, input });
  const project = projectById(tc.projectId);
  const saveText = (field: 'steps' | 'expected' | 'preconditions', value: string) => {
    const orig = (tc[field] ?? '') as string;
    if (value.trim() !== orig.trim()) patch({ [field]: value.trim() || null } as never);
  };

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[800] animate-fadeIn bg-[rgba(11,18,32,0.35)]" />
      <div className="fixed inset-y-0 right-0 z-[810] flex w-[min(720px,92vw)] animate-slideIn flex-col border-l border-border bg-surface shadow-4">
        <div className="flex items-center gap-2.5 border-b border-border px-[18px] py-3">
          <FlaskConical size={15} className="text-fg-3" />
          <span className="flex-none font-mono text-[12.5px] text-fg-3">{tc.id}</span>
          <Badge tone={TEST_RESULT[tc.result].tone}><ResultDot result={tc.result} size={7} /> {t(`tcResult.${tc.result}`)}</Badge>
          <div className="flex-1" />
          <Button variant="ghost" size="icon" onClick={() => del.mutate(tc.id, { onSuccess: onClose })} aria-label="delete">
            <Trash2 size={15} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="close">
            <X size={16} />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-y-auto px-7 py-6">
            <textarea
              value={tc.title}
              onChange={(e) => patch({ title: e.target.value })}
              rows={1}
              className="mb-4 w-full resize-none border-0 bg-transparent text-[21px] font-semibold leading-snug tracking-tight text-fg-1 outline-none"
            />
            <div className="mb-1.5 text-[12.5px] font-semibold text-fg-2">{t('testcases.preconditions')}</div>
            <textarea
              value={preconditions}
              onChange={(e) => setPreconditions(e.target.value)}
              onBlur={() => saveText('preconditions', preconditions)}
              rows={2}
              placeholder="—"
              className="mb-[18px] w-full resize-none rounded-[9px] border border-transparent bg-transparent text-sm leading-relaxed text-fg-1 outline-none placeholder:text-fg-3 hover:border-border focus:border-brand-blue focus:px-2.5 focus:py-2"
            />
            <div className="mb-1.5 text-[12.5px] font-semibold text-fg-2">{t('testcases.steps')}</div>
            <textarea
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              onBlur={() => saveText('steps', steps)}
              rows={Math.max(3, steps.split('\n').length)}
              placeholder={t('testcases.noSteps')}
              className="mb-[18px] w-full resize-none rounded-[9px] border border-transparent bg-transparent text-sm leading-relaxed text-fg-1 outline-none placeholder:text-fg-3 hover:border-border focus:border-brand-blue focus:px-2.5 focus:py-2"
            />
            <div className="mb-1.5 text-[12.5px] font-semibold text-fg-2">{t('testcases.expected')}</div>
            <textarea
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              onBlur={() => saveText('expected', expected)}
              rows={Math.max(2, expected.split('\n').length)}
              placeholder={t('testcases.noExpected')}
              className="w-full resize-none rounded-[9px] border border-transparent bg-transparent text-sm leading-relaxed text-fg-1 outline-none placeholder:text-fg-3 hover:border-border focus:border-brand-blue focus:px-2.5 focus:py-2"
            />
          </div>

          <div className="w-[238px] flex-none overflow-y-auto border-l border-border bg-surface px-4 py-5">
            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">{t('detail.props')}</div>
            <div className="flex flex-col gap-1.5">
              <PropRow label={t('testcases.result')}>
                <ResultMenu value={tc.result} onPick={(result) => patch({ result })} />
              </PropRow>
              <PropRow label={t('testcases.status')}>
                <StatusMenu value={tc.status} onPick={(status) => patch({ status })} />
              </PropRow>
              <PropRow label={t('requirements.priority')}>
                <PriorityMenu
                  current={tc.priority}
                  onPick={(priority) => patch({ priority })}
                  trigger={<button className="inline-flex items-center gap-1.5 rounded-[7px] px-2 py-1 text-[13px] text-fg-1 hover:bg-surface-2"><PriorityIcon priority={tc.priority} size={16} /> {t(`priority.${tc.priority}`)}</button>}
                />
              </PropRow>
            </div>
            <div className="my-4 h-px bg-border" />
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">{t('testcases.requirement')}</div>
            <select className={selCls} value={tc.requirementId ?? ''} onChange={(e) => patch({ requirementId: e.target.value || null })}>
              <option value="">{t('testcases.noRequirement')}</option>
              {reqs.map((r) => (
                <option key={r.id} value={r.id}>{r.id} · {r.title}</option>
              ))}
            </select>
            <div className="my-4 h-px bg-border" />
            <PropRow label={t('detail.belong')}>
              <span className="truncate text-[13px] text-fg-1">{project?.name ?? '—'}</span>
            </PropRow>
            <PropRow label={t('detail.assignee')}>
              <select className={selCls} value={tc.assigneeId ?? ''} onChange={(e) => patch({ assigneeId: e.target.value || null })}>
                <option value="">{t('common.unassigned')}</option>
                {[...humans, ...agents].map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </PropRow>
            <div className="mt-2 flex items-center gap-2 px-2">
              <Avatar person={memberById(tc.assigneeId)} size={20} />
              <span className="text-[12.5px] text-fg-2">{memberById(tc.assigneeId)?.name ?? t('common.unassigned')}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* List view                                                           */
/* ------------------------------------------------------------------ */
function TcRow({ tc, onOpen }: { tc: TestCase; onOpen: (id: string) => void }) {
  const { memberById } = useAppData();
  const update = useUpdateTestCase();
  return (
    <div
      onClick={() => onOpen(tc.id)}
      className="flex h-[42px] cursor-pointer items-center gap-2.5 border-b border-border px-5 transition-colors hover:bg-surface-2"
    >
      <ResultDot result={tc.result} />
      <span className="w-[52px] flex-none font-mono text-xs text-fg-3">{tc.id}</span>
      <EditableTitle value={tc.title} onSave={(title) => update.mutate({ id: tc.id, input: { title } })} className="min-w-0 flex-1 text-[13.5px] text-fg-1" />
      {tc.requirementId && (
        <span className="hidden items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium text-fg-2 sm:inline-flex">
          <Link2 size={10} /> {tc.requirementId}
        </span>
      )}
      <PriorityIcon priority={tc.priority} size={15} />
      <StatusMenu value={tc.status} onPick={(status) => update.mutate({ id: tc.id, input: { status } })} />
      <ResultMenu value={tc.result} onPick={(result) => update.mutate({ id: tc.id, input: { result } })} />
      <Avatar person={memberById(tc.assigneeId)} size={20} />
    </div>
  );
}

/* Full create modal (parity with 需求池's 新建需求). */
function NewTestCaseModal({
  open,
  onOpenChange,
  defaultProject,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultProject?: string;
  onCreated: (id: string) => void;
}) {
  const t = useT();
  const { projects } = useAppData();
  const { data: reqs = [] } = useAllRequirements();
  const create = useCreateTestCase();
  const [title, setTitle] = React.useState('');
  const [projectId, setProjectId] = React.useState('');
  const [requirementId, setRequirementId] = React.useState('');
  const [priority, setPriority] = React.useState<IssuePriority>('medium');
  const [status, setStatus] = React.useState<TestCaseStatus>('draft');
  const [result, setResult] = React.useState<TestResult>('untested');
  const [preconditions, setPreconditions] = React.useState('');
  const [steps, setSteps] = React.useState('');
  const [expected, setExpected] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setTitle('');
      setProjectId(defaultProject || projects[0]?.id || '');
      setRequirementId('');
      setPriority('medium');
      setStatus('draft');
      setResult('untested');
      setPreconditions('');
      setSteps('');
      setExpected('');
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultProject]);
  // keep a valid project selected (guards the controlled-<select> empty gotcha)
  React.useEffect(() => {
    if (open && !projectId && projects.length) setProjectId(projects[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, projects]);

  const submit = async () => {
    const pid = projectId || projects[0]?.id || '';
    if (!title.trim() || !pid || create.isPending) return;
    setError(null);
    try {
      const tc = await create.mutateAsync({
        projectId: pid,
        title: title.trim(),
        requirementId: requirementId || null,
        priority,
        status,
        result,
        preconditions: preconditions.trim() || null,
        steps: steps.trim() || null,
        expected: expected.trim() || null,
      });
      onOpenChange(false);
      onCreated(tc.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '创建失败，请重试');
    }
  };

  const ta = 'w-full resize-none rounded-lg border border-border-strong bg-surface px-2.5 py-2 text-[13px] leading-relaxed text-fg-1 outline-none focus:border-brand-blue';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <div className="flex items-center gap-2.5 px-[18px] pb-1 pt-4">
          <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: 'var(--brand-blue-tint-8)', color: 'var(--brand-blue)' }}>
            <FlaskConical size={15} />
          </span>
          <DialogPrimitive.Title className="text-[15px] font-semibold text-fg-1">{t('testcases.new')}</DialogPrimitive.Title>
        </div>
        <div className="flex flex-col gap-3 px-[18px] py-3">
          <div>
            <span className={fieldLabel}>{t('newReq.titleLabel')}</span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={t('newTc.titlePlaceholder')}
              className="h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-[15px] font-semibold text-fg-1 outline-none placeholder:font-normal placeholder:text-fg-3 focus:border-brand-blue"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <span className={fieldLabel}>{t('detail.belong')}</span>
              <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <span className={fieldLabel}>{t('testcases.requirement')}</span>
              <select className={inputCls} value={requirementId} onChange={(e) => setRequirementId(e.target.value)}>
                <option value="">{t('testcases.noRequirement')}</option>
                {reqs.map((r) => (
                  <option key={r.id} value={r.id}>{r.id} · {r.title}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <span className={fieldLabel}>{t('requirements.priority')}</span>
              <select className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value as IssuePriority)}>
                {PRIORITY_ORDER.map((p) => (
                  <option key={p} value={p}>{t(`priority.${p}`)}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <span className={fieldLabel}>{t('testcases.status')}</span>
              <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as TestCaseStatus)}>
                {TEST_CASE_STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{t(`tcStatus.${s}`)}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <span className={fieldLabel}>{t('testcases.result')}</span>
              <select className={inputCls} value={result} onChange={(e) => setResult(e.target.value as TestResult)}>
                {TEST_RESULT_ORDER.map((r) => (
                  <option key={r} value={r}>{t(`tcResult.${r}`)}</option>
                ))}
              </select>
            </div>
          </div>
          <textarea value={preconditions} onChange={(e) => setPreconditions(e.target.value)} rows={2} placeholder={t('testcases.preconditions')} className={ta} />
          <textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={3} placeholder={t('testcases.steps')} className={ta} />
          <textarea value={expected} onChange={(e) => setExpected(e.target.value)} rows={2} placeholder={t('testcases.expected')} className={ta} />
          {error && (
            <p className="rounded-md px-2.5 py-1.5 text-[12px]" style={{ background: 'var(--danger-50)', color: '#8C1B28' }}>{error}</p>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
          <div className="flex-1" />
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!title.trim() || create.isPending}>{t('testcases.new')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* The drawer is URL-driven (/testcases/<id>) by the page wrapper. */
export function TestCasesView({
  project,
  selected,
  onSelect,
}: {
  project?: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const t = useT();
  const { projects, can } = useAppData();
  const canWrite = can('testcases', 'write');
  const [projectFilter, setProjectFilter] = React.useState(project ?? '');
  // Follow an external ?project= change (e.g. arriving from a project hub tab).
  React.useEffect(() => {
    if (project != null) setProjectFilter(project);
  }, [project]);
  const [result, setResult] = React.useState<TestResult | ''>('');
  const [q, setQ] = React.useState('');
  const { data: cases = [] } = useTestCases({
    project: projectFilter || undefined,
    result: result || undefined,
  });
  const create = useCreateTestCase();
  const [newOpen, setNewOpen] = React.useState(false);

  const filtered = q ? cases.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()) || c.id.toLowerCase().includes(q.toLowerCase())) : cases;
  const targetProject = projectFilter || projects[0]?.id || '';

  const quickCreate = (title: string) => {
    if (!targetProject) return;
    create.mutate({ projectId: targetProject, title, status: 'draft', result: 'untested', priority: 'medium' });
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-6 py-3">
        <h1 className="m-0 text-[18px] font-semibold tracking-tight text-fg-1">{t('testcases.title')}</h1>
        <span className="rounded-full bg-surface-2 px-2.5 py-px text-[12.5px] font-semibold text-fg-3">{filtered.length}</span>
        <div className="relative ml-1">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('common.search')}
            className="h-8 w-[180px] rounded-lg border border-border bg-surface pl-7 pr-2 text-[12.5px] text-fg-1 outline-none focus:border-brand-blue"
          />
        </div>
        <div className="flex-1" />
        {/* result segmented filter */}
        <div className="inline-flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
          <SegBtn active={result === ''} onClick={() => setResult('')}>{t('common.all')}</SegBtn>
          {TEST_RESULT_ORDER.map((r) => (
            <SegBtn key={r} active={result === r} onClick={() => setResult(r)}>
              <ResultDot result={r} size={7} /> {t(`tcResult.${r}`)}
            </SegBtn>
          ))}
        </div>
        <select
          className="h-8 rounded-lg border border-border bg-surface px-2 text-[12.5px] text-fg-2 outline-none focus:border-brand-blue"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
        >
          <option value="">{t('requirements.allProjects')}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {canWrite && (
          <Button variant="primary" size="md" onClick={() => setNewOpen(true)}>
            <Plus size={14} /> {t('testcases.new')}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {canWrite && (
          <InlineCreateRow label={t('testcases.new')} placeholder={t('newTc.titlePlaceholder')} onCreate={quickCreate} className="border-b border-border" />
        )}
        {filtered.length === 0 ? (
          <div className="grid h-[40vh] place-items-center text-[13px] text-fg-3">
            <span className="flex items-center gap-2"><CircleDot size={14} /> {t('testcases.empty')}</span>
          </div>
        ) : (
          filtered.map((tc) => <TcRow key={tc.id} tc={tc} onOpen={onSelect} />)
        )}
      </div>

      {selected && <TestCaseDetail id={selected} onClose={() => onSelect(null)} />}
      <NewTestCaseModal open={newOpen} onOpenChange={setNewOpen} defaultProject={projectFilter || undefined} onCreated={onSelect} />
    </div>
  );
}
