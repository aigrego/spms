'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AlertTriangle, Folder, Target } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverTrigger, PopoverContent, MenuItem } from '@/components/ui/popover';
import { ProjectMenu } from '@/components/menus';
import { ProjectIcon } from '@/components/glyphs/misc';
import { useLocale, useT } from '@/lib/i18n';
import { useAppData } from '@/store/AppData';
import { useCreateSprint, useUpdateSprint, useDeleteSprint } from '@/store/sprints';
import { SPRINT_STATUS } from '@/lib/constants';
import type { Locale } from '@/lib/i18n';
import type { Sprint, SprintStatus } from '@/lib/types';

/* SprintModal — 新建/编辑迭代 (new in the Next.js rewrite; the spms-app
   blueprint has no sprint form). Strings live in a local dictionary (instead
   of src/lib/i18n.ts) to keep Phase C2 from touching files shared with
   parallel phases; reuse via useSprintDict(). */

const DICT: Record<Locale, Record<string, string>> = {
  'zh-CN': {
    create: '新建迭代',
    edit: '编辑迭代',
    namePh: '迭代名称，例如 Sprint 12',
    goal: '目标',
    goalPh: '这个迭代要达成什么？（可选）',
    project: '所属项目',
    pickProject: '选择项目',
    status: '状态',
    start: '开始日期',
    end: '结束日期',
    capacity: '容量（故事点）',
    capacityPh: '可选',
    dateErr: '结束日期不能早于开始日期',
    submit: '创建迭代',
    del: '删除',
    delTitle: '删除此迭代？',
    delBody: '删除后，迭代内的 Issue 会回到产品待办列表，Issue 本身不会被删除。',
    delConfirm: '删除迭代',
  },
  en: {
    create: 'New Sprint',
    edit: 'Edit Sprint',
    namePh: 'Sprint name, e.g. Sprint 12',
    goal: 'Goal',
    goalPh: 'What should this sprint achieve? (optional)',
    project: 'Project',
    pickProject: 'Select project',
    status: 'Status',
    start: 'Start date',
    end: 'End date',
    capacity: 'Capacity (story points)',
    capacityPh: 'Optional',
    dateErr: 'End date cannot be earlier than start date',
    submit: 'Create sprint',
    del: 'Delete',
    delTitle: 'Delete this sprint?',
    delBody: 'Issues in this sprint move back to the product backlog; the issues themselves are not deleted.',
    delConfirm: 'Delete sprint',
  },
  'zh-TW': {
    create: '新建迭代',
    edit: '編輯迭代',
    namePh: '迭代名稱，例如 Sprint 12',
    goal: '目標',
    goalPh: '這個迭代要達成什麼？（可選）',
    project: '所屬專案',
    pickProject: '選擇專案',
    status: '狀態',
    start: '開始日期',
    end: '結束日期',
    capacity: '容量（故事點）',
    capacityPh: '可選',
    dateErr: '結束日期不能早於開始日期',
    submit: '建立迭代',
    del: '刪除',
    delTitle: '刪除此迭代？',
    delBody: '刪除後，迭代內的 Issue 會回到產品待辦清單，Issue 本身不會被刪除。',
    delConfirm: '刪除迭代',
  },
};

export function useSprintDict() {
  const locale = useLocale();
  return DICT[locale] ?? DICT['zh-CN'];
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
  const s = useSprintDict();
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
              {s.delTitle}
            </DialogPrimitive.Title>
            <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">{s.delBody}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-[18px] py-3">
          <div className="flex-1" />
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" size="md" onClick={onConfirm} disabled={busy}>
            {s.delConfirm}
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
  const s = useSprintDict();
  const { projects, projectById } = useAppData();
  const create = useCreateSprint();
  const update = useUpdateSprint();
  const del = useDeleteSprint();
  const isEdit = !!sprint;

  const [name, setName] = React.useState('');
  const [goal, setGoal] = React.useState('');
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<SprintStatus>('planned');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [capacity, setCapacity] = React.useState('');
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [confirmDel, setConfirmDel] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(sprint?.name ?? '');
      setGoal(sprint?.goal ?? '');
      setProjectId(sprint?.projectId ?? null);
      setStatus(sprint?.status ?? 'planned');
      setStartDate(sprint?.startDate ?? '');
      setEndDate(sprint?.endDate ?? '');
      setCapacity(sprint?.capacity != null ? String(sprint.capacity) : '');
      setStatusOpen(false);
      setConfirmDel(false);
    }
  }, [open, sprint]);

  const project = projectById(projectId);
  const dateErr = !!startDate && !!endDate && endDate < startDate;
  const cap = capacity.trim() === '' ? null : Number(capacity);
  const capValid = cap === null || (Number.isFinite(cap) && cap >= 0);
  const valid = !!name.trim() && !!projectId && !!startDate && !!endDate && !dateErr && capValid;
  const busy = create.isPending || update.isPending;

  const submit = async () => {
    if (!valid || busy) return;
    if (isEdit && sprint) {
      await update.mutateAsync({
        id: sprint.id,
        input: {
          name: name.trim(),
          goal: goal.trim() || null,
          projectId,
          status,
          startDate,
          endDate,
          capacity: cap,
        },
      });
      onOpenChange(false);
    } else {
      const created = await create.mutateAsync({
        name: name.trim(),
        goal: goal.trim() || null,
        projectId,
        startDate,
        endDate,
        capacity: cap,
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
            {isEdit ? s.edit : s.create}
          </DialogPrimitive.Title>
          <div className="flex items-center gap-2 px-[18px] pt-3.5">
            <Target size={15} className="text-brand-blue" />
            <span className="text-[12.5px] font-medium text-fg-2">
              {isEdit ? s.edit : s.create}
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
              placeholder={s.namePh}
              className="w-full border-0 bg-transparent text-[19px] font-semibold text-fg-1 outline-none placeholder:text-fg-3"
            />

            <Field label={s.goal}>
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={2}
                placeholder={s.goalPh}
                className="w-full resize-none rounded-lg border border-border-strong bg-surface px-2.5 py-2 text-[13px] leading-relaxed text-fg-1 outline-none placeholder:text-fg-3 focus:border-brand-blue"
              />
            </Field>

            <div className="flex flex-wrap gap-3.5">
              <Field label={s.project}>
                <ProjectMenu
                  current={projectId}
                  onPick={setProjectId}
                  trigger={
                    <button
                      type="button"
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-2.5 text-[13px] text-fg-1 hover:bg-surface-2"
                    >
                      {project ? (
                        <span
                          className="grid h-[18px] w-[18px] place-items-center rounded"
                          style={{ background: project.color }}
                        >
                          <ProjectIcon name={project.icon} size={12} />
                        </span>
                      ) : (
                        <Folder size={15} className="text-fg-3" />
                      )}
                      {project ? project.name : s.pickProject}
                    </button>
                  }
                />
                {projects.length === 0 && (
                  <span className="mt-1 block text-[11.5px] text-fg-3">{t('menu.noProjects')}</span>
                )}
              </Field>

              {/* status is editable only in edit mode — the create API always
                  starts a sprint as `planned`. */}
              {isEdit && (
                <Field label={s.status}>
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
              <Field label={s.start}>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label={s.end}>
                <input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={inputCls}
                />
              </Field>
            </div>
            {dateErr && <div className="-mt-2 text-[12px] text-danger">{s.dateErr}</div>}

            <Field label={s.capacity}>
              <input
                type="number"
                min={0}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder={s.capacityPh}
                className={inputCls}
              />
            </Field>
          </div>

          <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
            {isEdit && (
              <Button variant="ghost" size="md" onClick={() => setConfirmDel(true)}>
                <span className="text-danger">{s.del}</span>
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" size="md" onClick={submit} disabled={!valid || busy}>
              {isEdit ? t('common.save') : s.submit}
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
