'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AlertTriangle, Target } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverTrigger, PopoverContent, MenuItem } from '@/components/ui/popover';
import { ProjectCheckList } from '@/components/ProjectCheckList';
import { useT } from '@/lib/i18n';
import { useAppData } from '@/store/AppData';
import { useCreateSprint, useUpdateSprint, useDeleteSprint } from '@/store/sprints';
import { SPRINT_STATUS } from '@/lib/constants';
import type { Sprint, SprintStatus } from '@/lib/types';

/* SprintModal — 新建/编辑迭代 (new in the Next.js rewrite; the spms-app
   blueprint has no sprint form). 文案走全局 i18n(TKT-27),key 前缀
   sprintModal.*,词典在 src/lib/i18n/sprint-reports.ts。 */

/* 兼容封装:ScrumViews 的迭代卡片仍通过 useSprintDict() 取文案。 */
export function useSprintDict() {
  const t = useT();
  return {
    create: t('sprintModal.create'),
    edit: t('sprintModal.edit'),
    namePh: t('sprintModal.namePh'),
    goal: t('sprintModal.goal'),
    goalPh: t('sprintModal.goalPh'),
    project: t('sprintModal.project'),
    projectsHint: t('sprintModal.projectsHint'),
    status: t('sprintModal.status'),
    start: t('sprintModal.start'),
    end: t('sprintModal.end'),
    dateErr: t('sprintModal.dateErr'),
    submit: t('sprintModal.submit'),
    del: t('sprintModal.del'),
    delTitle: t('sprintModal.delTitle'),
    delBody: t('sprintModal.delBody'),
    delConfirm: t('sprintModal.delConfirm'),
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-fg-3">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  'h-9 w-full rounded-lg border border-border-strong bg-surface px-2.5 text-[13px] text-fg-1 outline-none focus:border-brand-blue';

/* Lightweight plain confirm for sprint deletion — deleting a sprint only
   unmounts its issues back to the backlog (no cascade), so the type-to-confirm
   ConfirmDestructive would be overkill. Exported for the sprint card's delete
   action (SprintsView) as well. */
export function ConfirmDeleteSprint({
  open,
  onOpenChange,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  busy?: boolean;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="w-[min(420px,92vw)]">
        <div className="flex items-start gap-3 px-[18px] pb-1 pt-[18px]">
          <span
            className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-full"
            style={{ background: 'var(--danger-50)', color: 'var(--danger-500)' }}
          >
            <AlertTriangle size={17} />
          </span>
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-[15px] font-semibold text-fg-1">
              {t('sprintModal.delTitle')}
            </DialogPrimitive.Title>
            <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">{t('sprintModal.delBody')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-[18px] py-3">
          <div className="flex-1" />
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" size="md" onClick={onConfirm} disabled={busy}>
            {t('sprintModal.delConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SprintModal({
  open,
  onOpenChange,
  sprint = null,
  onCreated,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  // set → edit mode; null/undefined → create mode
  sprint?: Sprint | null;
  onCreated?: (id: string) => void;
  onDeleted?: (id: string) => void;
}) {
  const t = useT();
  const { projects } = useAppData();
  const create = useCreateSprint();
  const update = useUpdateSprint();
  const del = useDeleteSprint();
  const isEdit = !!sprint;

  const [name, setName] = React.useState('');
  const [goal, setGoal] = React.useState('');
  const [projectIds, setProjectIds] = React.useState<string[]>([]);
  const [status, setStatus] = React.useState<SprintStatus>('planned');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [confirmDel, setConfirmDel] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(sprint?.name ?? '');
      setGoal(sprint?.goal ?? '');
      setProjectIds(sprint?.projectIds ?? []);
      setStatus(sprint?.status ?? 'planned');
      // API 返回 ISO 时间戳,date input 需要 yyyy-MM-dd
      setStartDate(sprint?.startDate?.slice(0, 10) ?? '');
      setEndDate(sprint?.endDate?.slice(0, 10) ?? '');
      setStatusOpen(false);
      setConfirmDel(false);
    }
  }, [open, sprint]);

  const toggleProject = (id: string) =>
    setProjectIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const dateErr = !!startDate && !!endDate && endDate < startDate;
  const valid = !!name.trim() && projectIds.length > 0 && !!startDate && !!endDate && !dateErr;
  const busy = create.isPending || update.isPending;

  const submit = async () => {
    if (!valid || busy) return;
    if (isEdit && sprint) {
      await update.mutateAsync({
        id: sprint.id,
        input: {
          name: name.trim(),
          goal: goal.trim() || null,
          projectIds,
          status,
          startDate,
          endDate,
        },
      });
      onOpenChange(false);
    } else {
      const created = await create.mutateAsync({
        name: name.trim(),
        goal: goal.trim() || null,
        projectIds,
        startDate,
        endDate,
      });
      onOpenChange(false);
      onCreated?.(created.id);
    }
  };

  const doDelete = async () => {
    if (!sprint) return;
    await del.mutateAsync(sprint.id);
    setConfirmDel(false);
    onOpenChange(false);
    onDeleted?.(sprint.id);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent aria-describedby={undefined} className="w-[min(560px,92vw)]">
          <DialogPrimitive.Title className="sr-only">
            {isEdit ? t('sprintModal.edit') : t('sprintModal.create')}
          </DialogPrimitive.Title>
          <div className="flex items-center gap-2 px-[18px] pt-3.5">
            <Target size={15} className="text-brand-blue" />
            <span className="text-[12.5px] font-medium text-fg-2">
              {isEdit ? t('sprintModal.edit') : t('sprintModal.create')}
            </span>
            {isEdit && sprint && (
              <Badge tone={SPRINT_STATUS[sprint.status].tone} dot>
                {t(`sprintStatus.${sprint.status}`)}
              </Badge>
            )}
          </div>

          <div className="flex flex-col gap-3.5 px-[18px] pb-2 pt-3">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
              }}
              placeholder={t('sprintModal.namePh')}
              className="w-full border-0 bg-transparent text-[19px] font-semibold text-fg-1 outline-none placeholder:text-fg-3"
            />

            <Field label={t('sprintModal.goal')}>
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={4}
                placeholder={t('sprintModal.goalPh')}
                className="w-full resize-none rounded-lg border border-border-strong bg-surface px-2.5 py-2 text-[13px] leading-relaxed text-fg-1 outline-none placeholder:text-fg-3 focus:border-brand-blue"
              />
            </Field>

            <Field label={t('sprintModal.project')}>
              <ProjectCheckList projects={projects} selected={projectIds} onToggle={toggleProject} maxH="max-h-40" />
              {projects.length === 0 ? (
                <span className="mt-1 block text-[11.5px] text-fg-3">{t('menu.noProjects')}</span>
              ) : (
                <span className="mt-1 block text-[11.5px] text-fg-3">{t('sprintModal.projectsHint')}</span>
              )}
            </Field>

            <div className="flex flex-wrap gap-3.5">
              {/* status is editable only in edit mode — the create API always
                  starts a sprint as `planned`. */}
              {isEdit && (
                <Field label={t('sprintModal.status')}>
                  <Popover open={statusOpen} onOpenChange={setStatusOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-2.5 text-[13px] text-fg-1 hover:bg-surface-2"
                      >
                        <Badge tone={SPRINT_STATUS[status].tone} dot>
                          {t(`sprintStatus.${status}`)}
                        </Badge>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent style={{ width: 200 }} align="start">
                      {(['planned', 'active', 'completed'] as const).map((st) => (
                        <MenuItem
                          key={st}
                          glyph={
                            <span
                              className="h-2 w-2 flex-none rounded-full"
                              style={{ background: `var(--${st === 'active' ? 'brand-orange' : st === 'completed' ? 'success-500' : 'slate-500'})` }}
                            />
                          }
                          label={t(`sprintStatus.${st}`)}
                          selected={st === status}
                          onClick={() => {
                            setStatus(st);
                            setStatusOpen(false);
                          }}
                        />
                      ))}
                    </PopoverContent>
                  </Popover>
                </Field>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              <Field label={t('sprintModal.start')}>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label={t('sprintModal.end')}>
                <input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={inputCls}
                />
              </Field>
            </div>
            {dateErr && <div className="-mt-2 text-[12px] text-danger">{t('sprintModal.dateErr')}</div>}
          </div>

          <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
            {isEdit && (
              <Button variant="ghost" size="md" onClick={() => setConfirmDel(true)}>
                <span className="text-danger">{t('sprintModal.del')}</span>
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" size="md" onClick={submit} disabled={!valid || busy}>
              {isEdit ? t('common.save') : t('sprintModal.submit')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteSprint
        open={confirmDel}
        onOpenChange={setConfirmDel}
        busy={del.isPending}
        onConfirm={doDelete}
      />
    </>
  );
}
