'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { CalendarDays, CircleDot, Link2, Plus, Search, Trash2, X } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger, MenuItem } from '@/components/ui/popover';
import { Markdown } from '@/components/Markdown';
import { Skeleton } from '@/components/StateBlock';
import { Avatar } from '@/components/glyphs/Avatar';
import { PLAN_STATUS, PLAN_STATUS_ORDER, REQUIREMENT_TYPE, requirementStatusTone } from '@/lib/constants';
import { formatDate } from '@/lib/time';
import { useLocale, useT } from '@/lib/i18n';
import { useAppData } from '@/store/AppData';
import { useRequirements } from '@/store/requirements';
import { useCreatePlan, useDeletePlan, usePlan, usePlans, useUpdatePlan } from '@/store/plans';
import { ApiError } from '@/lib/api';
import type { Plan, PlanStatus } from '@/lib/types';

/* 开发计划 tab(TKT-68):项目级 markdown 计划,关联 N 条需求,内容待 AI Agent
   按模板生成。权限复用 requirements 模块(不新增 RBAC 模块)。 */

const fieldLabel = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-3';

/* ------------------------------------------------------------------ */
/* 新建计划 dialog                                                      */
/* ------------------------------------------------------------------ */
function NewPlanDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const t = useT();
  const { data: reqs = [] } = useRequirements({ project: projectId });
  const create = useCreatePlan();
  const [title, setTitle] = React.useState('');
  const [q, setQ] = React.useState('');
  const [checked, setChecked] = React.useState<string[]>([]);
  const [template, setTemplate] = React.useState<{ name: string; text: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const filtered = q
    ? reqs.filter((r) => r.title.toLowerCase().includes(q.toLowerCase()) || r.id.toLowerCase().includes(q.toLowerCase()))
    : reqs;

  const toggle = (id: string) =>
    setChecked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  // 模板只读文本入库(templateMd),不走 blob 上传。
  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    setTemplate({ name: f.name, text: await f.text() });
  };

  const submit = async () => {
    if (!title.trim() || create.isPending) return;
    setError(null);
    try {
      const plan = await create.mutateAsync({
        projectId,
        title: title.trim(),
        requirementIds: checked.length ? checked : undefined,
        templateMd: template?.text,
      });
      onClose();
      onCreated(plan.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.createFailed'));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <div className="flex items-center gap-2.5 px-[18px] pb-1 pt-4">
          <span
            className="grid h-7 w-7 place-items-center rounded-lg"
            style={{ background: 'var(--brand-blue-tint-8)', color: 'var(--brand-blue)' }}
          >
            <CalendarDays size={15} />
          </span>
          <DialogPrimitive.Title className="text-[15px] font-semibold text-fg-1">{t('plans.new')}</DialogPrimitive.Title>
        </div>

        <div className="flex flex-col gap-3 px-[18px] py-3">
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
            placeholder={t('plans.createTitle')}
            className="h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-[15px] font-semibold text-fg-1 outline-none placeholder:font-normal placeholder:text-fg-3 focus:border-brand-blue"
          />

          <div>
            <span className={fieldLabel}>{t('plans.linkReqs')}</span>
            <div className="rounded-lg border border-border">
              <div className="relative border-b border-border">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t('plans.searchReqs')}
                  className="h-8 w-full bg-transparent pl-7 pr-2 text-[12.5px] text-fg-1 outline-none placeholder:text-fg-3"
                />
              </div>
              <div className="max-h-[180px] overflow-y-auto p-1">
                {filtered.length === 0 ? (
                  <div className="px-2 py-3 text-center text-[12px] text-fg-3">{t('plans.noReqs')}</div>
                ) : (
                  filtered.map((r) => (
                    <label
                      key={r.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-2"
                    >
                      <input
                        type="checkbox"
                        checked={checked.includes(r.id)}
                        onChange={() => toggle(r.id)}
                        className="accent-[var(--brand-blue)]"
                      />
                      <span
                        className="h-2 w-2 flex-none rounded-full"
                        style={{ background: REQUIREMENT_TYPE[r.type].color }}
                      />
                      <span className="flex-none font-mono text-[11.5px] text-fg-3">{r.id}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-fg-1">{r.title}</span>
                      <Badge tone={requirementStatusTone(r.status)}>{t(`reqStatus.${r.status}`)}</Badge>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>

          <div>
            <span className={fieldLabel}>{t('plans.template')}</span>
            {template ? (
              <div className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg-2">{template.name}</span>
                <button
                  onClick={() => {
                    setTemplate(null);
                    if (fileRef.current) fileRef.current.value = '';
                  }}
                  className="grid h-5 w-5 place-items-center rounded text-fg-3 hover:bg-surface-2"
                  aria-label="clear template"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".md,.markdown,.txt"
                  className="hidden"
                  onChange={(e) => void pickFile(e.target.files?.[0])}
                />
                <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
                  {t('plans.chooseFile')}
                </Button>
                <p className="mt-1 text-[11.5px] leading-relaxed text-fg-3">{t('plans.templateHint')}</p>
              </>
            )}
          </div>

          {error && (
            <p className="rounded-md px-2.5 py-1.5 text-[12px]" style={{ background: 'var(--danger-50)', color: '#8C1B28' }}>
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
          <div className="flex-1" />
          <Button variant="ghost" size="md" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!title.trim() || create.isPending}>
            {t('plans.create')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* 计划详情 dialog                                                      */
/* ------------------------------------------------------------------ */
function StatusMenu({ value, onPick }: { value: PlanStatus; onPick: (s: PlanStatus) => void }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button>
          <Badge tone={PLAN_STATUS[value].tone} dot>
            {t(`planStatus.${value}`)}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[140px]">
        {PLAN_STATUS_ORDER.map((s) => (
          <MenuItem
            key={s}
            label={t(`planStatus.${s}`)}
            selected={s === value}
            onClick={() => {
              onPick(s);
              setOpen(false);
            }}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[30px] items-center gap-2.5">
      <span className="w-[64px] flex-none text-[12.5px] text-fg-3">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function PlanDetailBody({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const { memberById } = useAppData();
  const update = useUpdatePlan();
  const del = useDeletePlan();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(plan.content);
  // 服务端内容变化(保存后 invalidated refetch)时在渲染期同步草稿——
  // React 推荐的 derive-during-render 写法,避免 effect 级联渲染。
  const [synced, setSynced] = React.useState(plan.content);
  if (plan.content !== synced) {
    setSynced(plan.content);
    setDraft(plan.content);
  }

  const author = memberById(plan.authorId);
  const saveContent = () => {
    if (draft !== plan.content) update.mutate({ id: plan.id, input: { content: draft } });
  };

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-border px-[18px] py-3">
        <CalendarDays size={15} className="text-fg-3" />
        <span className="flex-none font-mono text-[12.5px] text-fg-3">{plan.id}</span>
        <Badge tone={PLAN_STATUS[plan.status].tone} dot>
          {t(`planStatus.${plan.status}`)}
        </Badge>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            if (window.confirm(t('plans.deleteConfirm'))) del.mutate(plan.id, { onSuccess: onClose });
          }}
          aria-label="delete"
        >
          <Trash2 size={15} />
        </Button>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="close">
          <X size={16} />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-7 py-6">
          <textarea
            value={plan.title}
            onChange={(e) => update.mutate({ id: plan.id, input: { title: e.target.value } })}
            rows={1}
            className="mb-4 w-full resize-none border-0 bg-transparent text-[21px] font-semibold leading-snug tracking-tight text-fg-1 outline-none"
          />
          {!editing && (
            <div className="mb-2 flex items-center justify-end">
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                {t('plans.edit')}
              </Button>
            </div>
          )}
          {editing ? (
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                saveContent();
                setEditing(false);
              }}
              rows={Math.max(8, draft.split('\n').length)}
              className="w-full resize-none rounded-[9px] border border-border bg-transparent px-2.5 py-2 font-mono text-[12.5px] leading-relaxed text-fg-1 outline-none focus:border-brand-blue"
            />
          ) : plan.content.trim() ? (
            <Markdown text={plan.content} className="text-[13.5px] leading-relaxed text-fg-1" />
          ) : (
            <div className="grid place-items-center rounded-[10px] border border-dashed border-border px-3 py-10 text-[12.5px] text-fg-3">
              <span className="flex items-center gap-2">
                <CircleDot size={14} /> {t('plans.contentEmpty')}
              </span>
            </div>
          )}
        </div>

        <div className="w-[238px] flex-none overflow-y-auto border-l border-border bg-surface px-4 py-5">
          <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">{t('detail.props')}</div>
          <div className="flex flex-col gap-1.5">
            <PropRow label={t('plans.status')}>
              <StatusMenu value={plan.status} onPick={(status) => update.mutate({ id: plan.id, input: { status } })} />
            </PropRow>
            <PropRow label={t('plans.creator')}>
              <span className="flex items-center gap-1.5 text-[13px] text-fg-1">
                <Avatar person={author} size={18} />
                <span className="truncate">{author?.name ?? '—'}</span>
              </span>
            </PropRow>
            <PropRow label={t('plans.updatedAt')}>
              <span className="text-[13px] text-fg-1">{formatDate(plan.updatedAt, locale)}</span>
            </PropRow>
          </div>
          {plan.requirements.length > 0 && (
            <>
              <div className="my-4 h-px bg-border" />
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
                {t('plans.linkReqs')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {plan.requirements.map((k) => (
                  <span
                    key={k}
                    className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-fg-2"
                  >
                    <Link2 size={10} /> {k}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function PlanDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: plan } = usePlan(id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined} className="flex h-[min(640px,84vh)] w-[min(880px,94vw)] flex-col p-0">
        <DialogPrimitive.Title className="sr-only">{id}</DialogPrimitive.Title>
        {plan ? <PlanDetailBody plan={plan} onClose={onClose} /> : <Skeleton rows={5} />}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* 列表                                                                 */
/* ------------------------------------------------------------------ */
export function PlansPanel({ projectId }: { projectId: string }) {
  const t = useT();
  const locale = useLocale();
  const { can } = useAppData();
  const canWrite = can('requirements', 'write');
  const { data: plans = [], isLoading } = usePlans({ project: projectId });
  const [selected, setSelected] = React.useState<string | null>(null);
  const [newOpen, setNewOpen] = React.useState(false);

  if (isLoading) return <Skeleton rows={4} />;

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-fg-2">{t('hub.plans')}</span>
        {canWrite && (
          <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}>
            <Plus size={14} /> {t('plans.new')}
          </Button>
        )}
      </div>

      {plans.length === 0 ? (
        <div className="grid place-items-center rounded-[10px] border border-dashed border-border px-3 py-8 text-center">
          <div className="flex items-center gap-2 text-[12.5px] text-fg-3">
            <CircleDot size={14} /> {t('plans.empty')}
          </div>
          <p className="mb-0 mt-1.5 max-w-[360px] text-[12px] leading-relaxed text-fg-3">{t('plans.emptyBody')}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-border">
          {plans.map((p) => (
            <div
              key={p.id}
              onClick={() => setSelected(p.id)}
              className="flex cursor-pointer items-center gap-2.5 border-b border-border bg-surface px-3 py-2 last:border-b-0 hover:bg-surface-2"
            >
              <CalendarDays size={15} className="flex-none text-fg-3" />
              <span className="flex-none font-mono text-[11.5px] text-fg-3">{p.id}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-fg-1">{p.title}</span>
              {p.requirements.length > 0 && (
                <span className="hidden items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-fg-2 sm:inline-flex">
                  <Link2 size={10} /> {p.requirements.length}
                </span>
              )}
              <span className="hidden text-[11.5px] tabular-nums text-fg-3 sm:inline">
                {formatDate(p.createdAt, locale)}
              </span>
              <Badge tone={PLAN_STATUS[p.status].tone} dot>
                {t(`planStatus.${p.status}`)}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {selected && <PlanDetailDialog id={selected} onClose={() => setSelected(null)} />}
      {/* 仅在打开时挂载:每次新建都是全新表单,无需 reset effect。 */}
      {newOpen && <NewPlanDialog projectId={projectId} onClose={() => setNewOpen(false)} onCreated={setSelected} />}
    </div>
  );
}
