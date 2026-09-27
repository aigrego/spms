'use client';

import * as React from 'react';
import { Trash2, FlaskConical, Link2, CircleDot, Plus, History, Play } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/glyphs/Avatar';
import { PriorityIcon } from '@/components/glyphs/PriorityIcon';
import { PriorityMenu, InlinePopover } from '@/components/menus';
import { MenuItem } from '@/components/ui/popover';
import { SegBtn } from '@/components/ui/segmented';
import { ProjectFilterMenu, useProjectFilter } from '@/components/ProjectFilterMenu';
import { InlineCreateRow, EditableTitle } from '@/components/inline';
import { DetailDrawer } from '@/components/DetailDrawer';
import { ViewHeader, fieldLabel, inputCls } from '@/components/common';
import { TEST_CASE_STATUS, TEST_CASE_STATUS_ORDER, TEST_RESULT, TEST_RESULT_ORDER, TEST_CATEGORY, TEST_CATEGORY_ORDER, PRIORITY_ORDER } from '@/lib/constants';
import { useT, useLocale } from '@/lib/i18n';
import { formatActivityTime } from '@/lib/time';
import { usePersistentState } from '@/lib/prefs';
import { useAppData } from '@/store/AppData';
import { useAllRequirements } from '@/store/requirements';
import { useTestCases, useTestCase, useCreateTestCase, useUpdateTestCase, useDeleteTestCase, useTestRuns, useRecordTestRun } from '@/store/testcases';
import { ApiError } from '@/lib/api';
import type { RecordTestRunInput } from '@/lib/api';
import type { TestCase, TestResult, TestCaseStatus, TestCaseCategory, IssuePriority, TestRun } from '@/lib/types';

const isCategoryFilter = (v: unknown): v is TestCaseCategory | '' =>
  v === '' || (TEST_CATEGORY_ORDER as readonly string[]).includes(v as string);
const isResultFilter = (v: unknown): v is TestResult | '' =>
  v === '' || (TEST_RESULT_ORDER as readonly string[]).includes(v as string);

const selCls =
  'w-full rounded-[7px] border border-transparent bg-transparent px-2 py-1 text-[13px] text-fg-1 hover:bg-surface-2 focus:border-brand-blue focus:bg-surface outline-none';

function ResultDot({ result, size = 9 }: { result: TestResult; size?: number }) {
  return <span className="inline-block flex-none rounded-full" style={{ width: size, height: size, background: TEST_RESULT[result].color }} />;
}

function CategoryDot({ category, size = 9 }: { category: TestCaseCategory; size?: number }) {
  return <span className="inline-block flex-none rounded-full" style={{ width: size, height: size, background: TEST_CATEGORY[category].color }} />;
}

/* Quick-change the last-run result from the list without opening the drawer. */
function TcResultMenu({ value, onPick }: { value: TestResult; onPick: (r: TestResult) => void }) {
  const t = useT();
  return (
    <InlinePopover
      width={150}
      align="end"
      trigger={
        <button>
          <Badge tone={TEST_RESULT[value].tone}>
            <ResultDot result={value} size={7} /> {t(`tcResult.${value}`)}
          </Badge>
        </button>
      }
    >
      {(close) => (
        <>
          {TEST_RESULT_ORDER.map((r) => (
            <MenuItem
              key={r}
              glyph={<ResultDot result={r} />}
              label={t(`tcResult.${r}`)}
              selected={r === value}
              onClick={() => {
                onPick(r);
                close();
              }}
            />
          ))}
        </>
      )}
    </InlinePopover>
  );
}

function TcStatusMenu({ value, onPick }: { value: TestCaseStatus; onPick: (s: TestCaseStatus) => void }) {
  const t = useT();
  return (
    <InlinePopover
      width={140}
      align="end"
      trigger={
        <button>
          <Badge tone={TEST_CASE_STATUS[value].tone} dot>
            {t(`tcStatus.${value}`)}
          </Badge>
        </button>
      }
    >
      {(close) => (
        <>
          {TEST_CASE_STATUS_ORDER.map((s) => (
            <MenuItem key={s} label={t(`tcStatus.${s}`)} selected={s === value} onClick={() => { onPick(s); close(); }} />
          ))}
        </>
      )}
    </InlinePopover>
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

  if (!tc) return null;
  const patch = (input: Parameters<typeof update.mutate>[0]['input']) => update.mutate({ id, input });
  const project = projectById(tc.projectId);
  const saveText = (field: 'steps' | 'expected' | 'preconditions', value: string) => {
    const orig = (tc[field] ?? '') as string;
    if (value.trim() !== orig.trim()) patch({ [field]: value.trim() || null } as never);
  };

  return (
    <DetailDrawer
      onClose={onClose}
      width={720}
      header={
        <>
          <FlaskConical size={15} className="text-fg-3" />
          <span className="flex-none font-mono text-[12.5px] text-fg-3">{tc.id}</span>
          <Badge tone={TEST_RESULT[tc.result].tone}><ResultDot result={tc.result} size={7} /> {t(`tcResult.${tc.result}`)}</Badge>
        </>
      }
      headerActions={
        <Button variant="ghost" size="icon" onClick={() => del.mutate(tc.id, { onSuccess: onClose })} aria-label="delete">
          <Trash2 size={15} />
        </Button>
      }
    >
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
                <TcResultMenu value={tc.result} onPick={(result) => patch({ result })} />
              </PropRow>
              <PropRow label={t('testcases.status')}>
                <TcStatusMenu value={tc.status} onPick={(status) => patch({ status })} />
              </PropRow>
              <PropRow label={t('testcases.category')}>
                <select className={selCls} value={tc.category} onChange={(e) => patch({ category: e.target.value as TestCaseCategory })}>
                  {TEST_CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>{t(`tcCategory.${c}`)}</option>
                  ))}
                </select>
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
            <div className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wider text-fg-3">{t('testcases.issue')}</div>
            <input
              key={tc.id}
              defaultValue={tc.issueId ?? ''}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== (tc.issueId ?? '')) patch({ issueId: v || null });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur();
              }}
              placeholder={t('testcases.issuePlaceholder')}
              className={selCls}
            />
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
    </DetailDrawer>
  );
}

/* ------------------------------------------------------------------ */
/* List view                                                           */
/* ------------------------------------------------------------------ */
function TcRow({ tc, onOpen }: { tc: TestCase; onOpen: (id: string) => void }) {
  const t = useT();
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
      <Badge tone={TEST_CATEGORY[tc.category].tone}>
        <CategoryDot category={tc.category} size={7} /> {t(`tcCategory.${tc.category}`)}
      </Badge>
      {tc.requirementId && (
        <span className="hidden items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium text-fg-2 sm:inline-flex">
          <Link2 size={10} /> {tc.requirementId}
        </span>
      )}
      <PriorityIcon priority={tc.priority} size={15} />
      <TcStatusMenu value={tc.status} onPick={(status) => update.mutate({ id: tc.id, input: { status } })} />
      <TcResultMenu value={tc.result} onPick={(result) => update.mutate({ id: tc.id, input: { result } })} />
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
  const [issueId, setIssueId] = React.useState('');
  const [category, setCategory] = React.useState<TestCaseCategory>('functional');
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
      setIssueId('');
      setCategory('functional');
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
        issueId: issueId.trim() || null,
        category,
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
      setError(e instanceof ApiError ? e.message : t('common.createFailed'));
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
            <div className="flex-1">
              <span className={fieldLabel}>{t('testcases.issue')}</span>
              <input value={issueId} onChange={(e) => setIssueId(e.target.value)} placeholder={t('testcases.issuePlaceholder')} className={inputCls} />
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
            <div className="flex-1">
              <span className={fieldLabel}>{t('testcases.category')}</span>
              <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as TestCaseCategory)}>
                {TEST_CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>{t(`tcCategory.${c}`)}</option>
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

/* ------------------------------------------------------------------ */
/* Test runs — 执行记录面板 + 执行套件弹窗                              */
/* ------------------------------------------------------------------ */

/* 一次执行的明细行:结果点 + 用例 key + 备注。 */
function RunItems({ run }: { run: TestRun }) {
  if (!run.items?.length) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-0.5">
      {run.items.map((it, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[12px] text-fg-2">
          <ResultDot result={it.result} size={7} />
          <span className="flex-none font-mono text-fg-3">{it.testCase}</span>
          {it.note && <span className="min-w-0 truncate text-fg-3">· {it.note}</span>}
        </div>
      ))}
    </div>
  );
}

/* 执行历史(倒序):谁/何时/哪类套件/哪个范围/汇总/备注/逐条结果。 */
function TestRunsPanel({ onClose, onRunSuite, canWrite }: { onClose: () => void; onRunSuite: () => void; canWrite: boolean }) {
  const t = useT();
  const locale = useLocale();
  const { memberById, projectById, releaseById } = useAppData();
  const { data: runs = [] } = useTestRuns();
  return (
    <DetailDrawer
      onClose={onClose}
      width={640}
      header={
        <>
          <History size={15} className="text-fg-3" />
          <span className="text-[14px] font-semibold text-fg-1">{t('testruns.title')}</span>
          <span className="rounded-full bg-surface-2 px-2.5 py-px text-[12.5px] font-semibold text-fg-3">{runs.length}</span>
        </>
      }
      headerActions={
        canWrite ? (
          <Button variant="primary" size="sm" onClick={onRunSuite}>
            <Play size={13} /> {t('testruns.run')}
          </Button>
        ) : undefined
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {runs.length === 0 ? (
          <div className="grid h-[40vh] place-items-center text-[13px] text-fg-3">
            <span className="flex items-center gap-2"><CircleDot size={14} /> {t('testruns.empty')}</span>
          </div>
        ) : (
          runs.map((run) => (
            <div key={run.id} className="border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <Badge tone={TEST_CATEGORY[run.category].tone}>
                  <CategoryDot category={run.category} size={7} /> {t(`tcCategory.${run.category}`)}
                </Badge>
                <span className="min-w-0 truncate text-[12px] text-fg-3">
                  {run.projectId
                    ? projectById(run.projectId)?.name ?? ''
                    : `${t('detail.release')} · ${releaseById(run.releaseId)?.name ?? ''}`}
                </span>
                <div className="flex-1" />
                <span className="flex-none text-[12px] text-fg-3">{formatActivityTime(run.createdAt, locale)}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <Avatar person={memberById(run.executorId)} size={18} />
                <span className="text-[12.5px] text-fg-2">{memberById(run.executorId)?.name ?? t('detail.system')}</span>
                <div className="flex-1" />
                <div className="flex items-center gap-2 text-[12px] font-medium">
                  {(['passed', 'failed', 'blocked'] as const)
                    .filter((r) => run[r] > 0)
                    .map((r) => (
                      <span key={r} className="inline-flex items-center gap-1" style={{ color: TEST_RESULT[r].color }}>
                        <ResultDot result={r} size={7} /> {run[r]}
                      </span>
                    ))}
                  <span className="text-fg-3">/ {run.total}</span>
                </div>
              </div>
              {run.note && <div className="mt-1 text-[12.5px] text-fg-2">{run.note}</div>}
              <RunItems run={run} />
            </div>
          ))
        )}
      </div>
    </DetailDrawer>
  );
}

/* 执行套件:选 category + 范围(项目/版本)→ 取该范围的待执行用例(非废弃),
   逐条标记结果(复用 TcResultMenu),提交调 recordTestRun。范围/类别与服务端
   listSuite 同语义;结果沿用用例当前值,仅提交非 untested 的行(避免把未执行
   的 draft 用例误推进为 active)。条件挂载(打开时才渲染),状态用初始值即可,
   关闭再打开自动重置。 */
function RunSuiteModal({
  open,
  onOpenChange,
  defaultProject,
  defaultCategory,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultProject?: string;
  defaultCategory?: TestCaseCategory;
}) {
  const t = useT();
  const { projects, releases } = useAppData();
  const record = useRecordTestRun();
  const [category, setCategory] = React.useState<TestCaseCategory>(defaultCategory || 'functional');
  // 'p:<projectId>' | 'r:<releaseId>'
  const [scope, setScope] = React.useState(() => {
    if (defaultProject) return `p:${defaultProject}`;
    const firstProject = projects.find((p) => !p.archivedAt);
    if (firstProject) return `p:${firstProject.id}`;
    return releases[0] ? `r:${releases[0].id}` : '';
  });
  const [marks, setMarks] = React.useState<Record<string, { result: TestResult; note: string }>>({});
  const [note, setNote] = React.useState('');
  const [raiseBugs, setRaiseBugs] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const activeProjects = projects.filter((p) => !p.archivedAt);

  // 待执行清单:该类别全量用例(共享主列表缓存)按范围过滤,与 listSuite 同口径。
  const { data: catCases = [], isLoading } = useTestCases({ category });
  const suite = React.useMemo(() => {
    if (!scope) return [];
    const ids = scope.startsWith('p:')
      ? [scope.slice(2)]
      : projects.filter((p) => p.releaseId === scope.slice(2)).map((p) => p.id);
    return catCases.filter((c) => ids.includes(c.projectId) && c.status !== 'deprecated');
  }, [scope, catCases, projects]);

  const markOf = (key: string, fallback: TestResult) => marks[key] ?? { result: fallback, note: '' };
  const executable = suite.filter((tc) => markOf(tc.id, tc.result).result !== 'untested');
  const hasFailed = executable.some((tc) => markOf(tc.id, tc.result).result === 'failed');

  const submit = async () => {
    if (!scope || !executable.length || record.isPending) return;
    setError(null);
    const input: RecordTestRunInput = {
      category,
      ...(scope.startsWith('p:') ? { projectId: scope.slice(2) } : { releaseId: scope.slice(2) }),
      results: executable.map((tc) => {
        const m = markOf(tc.id, tc.result);
        return { key: tc.id, result: m.result, ...(m.note.trim() ? { note: m.note.trim() } : {}) };
      }),
      ...(note.trim() ? { note: note.trim() } : {}),
      raiseBugs: raiseBugs && hasFailed,
    };
    try {
      await record.mutateAsync(input);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.createFailed'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <div className="flex items-center gap-2.5 px-[18px] pb-1 pt-4">
          <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: 'var(--brand-blue-tint-8)', color: 'var(--brand-blue)' }}>
            <Play size={15} />
          </span>
          <DialogPrimitive.Title className="text-[15px] font-semibold text-fg-1">{t('testruns.run')}</DialogPrimitive.Title>
        </div>
        <div className="flex flex-col gap-3 px-[18px] py-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <span className={fieldLabel}>{t('testcases.category')}</span>
              <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as TestCaseCategory)}>
                {TEST_CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>{t(`tcCategory.${c}`)}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <span className={fieldLabel}>{t('testruns.scope')}</span>
              <select className={inputCls} value={scope} onChange={(e) => setScope(e.target.value)}>
                <optgroup label={t('nav.projects')}>
                  {activeProjects.map((p) => (
                    <option key={p.id} value={`p:${p.id}`}>{p.name}</option>
                  ))}
                </optgroup>
                <optgroup label={t('products.releasesLabel')}>
                  {releases.map((r) => (
                    <option key={r.id} value={`r:${r.id}`}>{r.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>
          <div className="max-h-[46vh] overflow-y-auto rounded-lg border border-border">
            {suite.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12.5px] text-fg-3">
                {isLoading ? t('loading') : t('testruns.noSuite')}
              </div>
            ) : (
              suite.map((tc) => {
                const m = markOf(tc.id, tc.result);
                return (
                  <div key={tc.id} className="flex items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0">
                    <span className="w-[52px] flex-none font-mono text-xs text-fg-3">{tc.id}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-fg-1" title={tc.title}>{tc.title}</span>
                    {m.result === 'failed' && (
                      <input
                        value={m.note}
                        onChange={(e) => setMarks((prev) => ({ ...prev, [tc.id]: { ...m, note: e.target.value } }))}
                        placeholder={t('testruns.failNotePlaceholder')}
                        className="w-[170px] flex-none rounded-[7px] border border-border-strong bg-surface px-2 py-1 text-[12px] text-fg-1 outline-none focus:border-brand-blue"
                      />
                    )}
                    <TcResultMenu
                      value={m.result}
                      onPick={(result) => setMarks((prev) => ({ ...prev, [tc.id]: { ...markOf(tc.id, tc.result), result } }))}
                    />
                  </div>
                );
              })
            )}
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('testruns.notePlaceholder')} className={inputCls} />
          <label className="flex items-center gap-2 text-[12.5px] text-fg-2">
            <input type="checkbox" checked={raiseBugs} onChange={(e) => setRaiseBugs(e.target.checked)} disabled={!hasFailed} />
            {t('testruns.raiseBugs')}
          </label>
          {error && (
            <p className="rounded-md px-2.5 py-1.5 text-[12px]" style={{ background: 'var(--danger-50)', color: '#8C1B28' }}>{error}</p>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
          <div className="flex-1" />
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!executable.length || record.isPending}>
            {t('testruns.submit')}{executable.length > 0 ? ` (${executable.length})` : ''}
          </Button>
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
  // 项目筛选复用「全部 Issues」的共享 hook,与需求池/侧边栏即时互相同步。
  const [projectFilter, setProjectFilter] = useProjectFilter();
  // Follow an external ?project= change (e.g. arriving from a project hub tab).
  React.useEffect(() => {
    if (project != null) setProjectFilter(project || 'all');
  }, [project, setProjectFilter]);
  // 类别/结果筛选各自持久化(本页私有 key)。
  const [result, setResult] = usePersistentState<TestResult | ''>('testcases.resultFilter', '', isResultFilter);
  const [category, setCategory] = usePersistentState<TestCaseCategory | ''>('testcases.categoryFilter', '', isCategoryFilter);
  const projectId = projectFilter === 'all' ? '' : projectFilter;
  const { data: cases = [] } = useTestCases({
    project: projectId || undefined,
    result: result || undefined,
    category: category || undefined,
  });
  const create = useCreateTestCase();
  const [newOpen, setNewOpen] = React.useState(false);
  const [runsOpen, setRunsOpen] = React.useState(false);
  const [suiteOpen, setSuiteOpen] = React.useState(false);

  const targetProject = projectId || projects[0]?.id || '';

  const quickCreate = (title: string) => {
    if (!targetProject) return;
    create.mutate({ projectId: targetProject, title, status: 'draft', result: 'untested', priority: 'medium', category: category || undefined });
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* toolbar —— 与「全部 Issues」同款两行布局:标题行(标题/计数/新建) + 筛选行(项目筛选在最前)。 */}
      <div className="border-b border-border">
        <ViewHeader title={t('testcases.title')} count={cases.length} bordered={false}>
          <Button variant="ghost" size="md" onClick={() => setRunsOpen(true)}>
            <History size={14} /> {t('testruns.title')}
          </Button>
          {canWrite && (
            <Button variant="primary" size="md" onClick={() => setNewOpen(true)}>
              <Plus size={14} /> {t('testcases.new')}
            </Button>
          )}
        </ViewHeader>
        <div className="flex flex-wrap items-center gap-2 px-6 pb-3">
          {/* 项目筛选 —— 复用「全部 Issues」的共享组件,共享浏览器记忆。 */}
          <ProjectFilterMenu />
          {/* category segmented filter */}
          <div className="inline-flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
            <SegBtn active={category === ''} onClick={() => setCategory('')}>{t('testcases.allCategories')}</SegBtn>
            {TEST_CATEGORY_ORDER.map((c) => (
              <SegBtn key={c} active={category === c} onClick={() => setCategory(c)}>
                <CategoryDot category={c} size={7} /> {t(`tcCategory.${c}`)}
              </SegBtn>
            ))}
          </div>
          {/* result segmented filter */}
          <div className="inline-flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
            <SegBtn active={result === ''} onClick={() => setResult('')}>{t('common.all')}</SegBtn>
            {TEST_RESULT_ORDER.map((r) => (
              <SegBtn key={r} active={result === r} onClick={() => setResult(r)}>
                <ResultDot result={r} size={7} /> {t(`tcResult.${r}`)}
              </SegBtn>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {canWrite && (
          <InlineCreateRow label={t('testcases.new')} placeholder={t('newTc.titlePlaceholder')} onCreate={quickCreate} className="border-b border-border" />
        )}
        {cases.length === 0 ? (
          <div className="grid h-[40vh] place-items-center text-[13px] text-fg-3">
            <span className="flex items-center gap-2"><CircleDot size={14} /> {t('testcases.empty')}</span>
          </div>
        ) : (
          cases.map((tc) => <TcRow key={tc.id} tc={tc} onOpen={onSelect} />)
        )}
      </div>

      {selected && <TestCaseDetail id={selected} onClose={() => onSelect(null)} />}
      <NewTestCaseModal open={newOpen} onOpenChange={setNewOpen} defaultProject={projectId || undefined} onCreated={onSelect} />
      {runsOpen && (
        <TestRunsPanel onClose={() => setRunsOpen(false)} canWrite={canWrite} onRunSuite={() => setSuiteOpen(true)} />
      )}
      {/* 条件挂载:套件清单查询只在弹窗打开时发起。 */}
      {suiteOpen && (
        <RunSuiteModal
          open={suiteOpen}
          onOpenChange={setSuiteOpen}
          defaultProject={projectId || undefined}
          defaultCategory={category || undefined}
        />
      )}
    </div>
  );
}
