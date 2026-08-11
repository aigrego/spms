'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X, Trash2, GitBranch, Sparkles, FileText, Search, ListTree } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger, MenuItem } from '@/components/ui/popover';
import { SegBtn, TabBtn } from '@/components/ui/segmented';
import { InlineCreateRow, EditableTitle } from '@/components/inline';
import { StatusIcon } from '@/components/glyphs/StatusIcon';
import { PriorityIcon } from '@/components/glyphs/PriorityIcon';
import { ImportanceIcon } from '@/components/glyphs/ImportanceIcon';
import { Avatar } from '@/components/glyphs/Avatar';
import { ProjectIcon } from '@/components/glyphs/misc';
import { PriorityMenu, ImportanceMenu } from '@/components/menus';
import {
  REQUIREMENT_TYPE,
  REQUIREMENT_STATUS,
  REQUIREMENT_STATUS_ORDER,
  REQUIREMENT_CATEGORY_ORDER,
  PRIORITY_ORDER,
} from '@/lib/constants';
import { useT } from '@/lib/i18n';
import { useAppData } from '@/store/AppData';
import { useAllIssues } from '@/store/issues';
import {
  useRequirements,
  useRequirement,
  useCreateRequirement,
  useUpdateRequirement,
  useDeleteRequirement,
  useDecomposeRequirement,
} from '@/store/requirements';
import { ApiError } from '@/lib/api';
import { usePersistentState } from '@/lib/prefs';
import { decompositionItemsFor } from '@/lib/decompose';
import type {
  Requirement,
  RequirementType,
  RequirementCategory,
  RequirementStatus,
  IssuePriority,
  Importance,
} from '@/lib/types';

const TYPE_ORDER: RequirementType[] = ['functional', 'non_functional'];

/* Validators for the persisted toolbar prefs (browser memory) — reject values
   written by older versions or foreign code so the view never breaks. */
type StatusFilter = RequirementStatus | '';
const isTypeTab = (v: unknown): v is RequirementType => TYPE_ORDER.includes(v as RequirementType);
const isStatusFilter = (v: unknown): v is StatusFilter =>
  v === '' || (REQUIREMENT_STATUS_ORDER as RequirementStatus[]).includes(v as RequirementStatus);

const inputCls =
  'h-9 w-full rounded-lg border border-border-strong bg-surface px-2.5 text-[13px] text-fg-1 outline-none focus:border-brand-blue';
const fieldLabel = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-3';

function TypeTag({ type }: { type: RequirementType }) {
  const t = useT();
  const cfg = REQUIREMENT_TYPE[type];
  return (
    <span
      className="inline-flex flex-none items-center rounded-[5px] px-1.5 py-px text-[10.5px] font-semibold"
      style={{ background: `${cfg.color}1A`, color: cfg.color }}
    >
      {t(`reqType.${type}`)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* New requirement modal                                              */
/* ------------------------------------------------------------------ */
function NewRequirementModal({
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
  const { projects, projectById, releases, productById } = useAppData();
  const create = useCreateRequirement();
  const [title, setTitle] = React.useState('');
  const [projectId, setProjectId] = React.useState('');
  const [releaseId, setReleaseId] = React.useState('');
  const [type, setType] = React.useState<RequirementType>('functional');
  const [category, setCategory] = React.useState<RequirementCategory>('performance');
  const [priority, setPriority] = React.useState<IssuePriority>('none');
  const [importance, setImportance] = React.useState<Importance>('none');
  const [status, setStatus] = React.useState<RequirementStatus>('draft');
  const [desc, setDesc] = React.useState('');
  const [acceptance, setAcceptance] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  // Releases grouped by product for the target-version picker.
  const releaseOptions = releases.map((r) => ({ id: r.id, label: `${productById(r.productId)?.name ?? ''} · ${r.name}` }));

  React.useEffect(() => {
    if (open) {
      const pid = defaultProject || projects[0]?.id || '';
      setTitle('');
      setProjectId(pid);
      // PMS-2 §4.3: default the target version to the project's release.
      setReleaseId(projectById(pid)?.releaseId ?? '');
      setType('functional');
      setCategory('performance');
      setPriority('none');
      setImportance('none');
      setStatus('draft');
      setDesc('');
      setAcceptance('');
      setError(null);
    }
    // Reset only on open (reading the current projects); depending on `projects`
    // would wipe the form on any background bootstrap refetch while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultProject]);

  // Keep a valid project selected: covers projects loading after open and the
  // controlled-<select> gotcha where an empty value renders the first option but
  // leaves state '' (then submit would silently bail with no project).
  React.useEffect(() => {
    if (open && !projectId && projects.length) {
      const pid = projects[0].id;
      setProjectId(pid);
      setReleaseId(projectById(pid)?.releaseId ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, projects]);

  const submit = async () => {
    const pid = projectId || projects[0]?.id || '';
    if (!title.trim() || !pid || create.isPending) return;
    setError(null);
    try {
      const req = await create.mutateAsync({
        projectId: pid,
        releaseId: releaseId || null,
        title: title.trim(),
        type,
        category: type === 'non_functional' ? category : null,
        priority,
        importance,
        status,
        description: desc.trim() || null,
        acceptanceCriteria: acceptance.trim() || null,
      });
      onOpenChange(false);
      onCreated(req.id);
    } catch (e) {
      // Surface the failure instead of the click looking like a no-op.
      setError(e instanceof ApiError ? e.message : t('common.createFailed'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogPrimitive.Title className="px-[18px] pb-1 pt-4 text-[15px] font-semibold text-fg-1">
          {t('newReq.title')}
        </DialogPrimitive.Title>
        <div className="flex flex-col gap-3 px-[18px] py-3">
          <div>
            <span className={fieldLabel}>{t('newReq.titleLabel')}</span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                // Enter submits (skip while an IME composition is active).
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={t('newReq.titlePlaceholder')}
              className="h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-[15px] font-semibold text-fg-1 outline-none placeholder:font-normal placeholder:text-fg-3 focus:border-brand-blue"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <span className={fieldLabel}>{t('requirements.project')}</span>
              <select
                className={inputCls}
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setReleaseId(projectById(e.target.value)?.releaseId ?? '');
                }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <span className={fieldLabel}>{t('requirements.release')}</span>
              <select className={inputCls} value={releaseId} onChange={(e) => setReleaseId(e.target.value)}>
                <option value="">{t('requirements.noRelease')}</option>
                {releaseOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <span className={fieldLabel}>{t('requirements.type')}</span>
              <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as RequirementType)}>
                {TYPE_ORDER.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`reqType.${ty}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            {type === 'non_functional' && (
              <div className="flex-1">
                <span className={fieldLabel}>{t('requirements.category')}</span>
                <select
                  className={inputCls}
                  value={category}
                  onChange={(e) => setCategory(e.target.value as RequirementCategory)}
                >
                  {REQUIREMENT_CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>
                      {t(`reqCategory.${c}`)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex-1">
              <span className={fieldLabel}>{t('requirements.status')}</span>
              <select
                className={inputCls}
                value={status}
                onChange={(e) => setStatus(e.target.value as RequirementStatus)}
              >
                {REQUIREMENT_STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {t(`reqStatus.${s}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <span className={fieldLabel}>{t('requirements.priority')}</span>
              <select
                className={inputCls}
                value={priority}
                onChange={(e) => setPriority(e.target.value as IssuePriority)}
              >
                {PRIORITY_ORDER.map((p) => (
                  <option key={p} value={p}>
                    {t(`priority.${p}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <span className={fieldLabel}>{t('requirements.importance')}</span>
              <select
                className={inputCls}
                value={importance}
                onChange={(e) => setImportance(e.target.value as Importance)}
              >
                {(['critical', 'high', 'medium', 'low', 'none'] as Importance[]).map((p) => (
                  <option key={p} value={p}>
                    {t(`importance.${p}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={3}
            placeholder={t('newReq.descPlaceholder')}
            className="w-full resize-none rounded-lg border border-border-strong bg-surface px-2.5 py-2 text-[13px] leading-relaxed text-fg-1 outline-none focus:border-brand-blue"
          />
          <textarea
            value={acceptance}
            onChange={(e) => setAcceptance(e.target.value)}
            rows={2}
            placeholder={t('newReq.acceptancePlaceholder')}
            className="w-full resize-none rounded-lg border border-border-strong bg-surface px-2.5 py-2 text-[13px] leading-relaxed text-fg-1 outline-none focus:border-brand-blue"
          />
        </div>
        <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
          {error && (
            <span className="truncate rounded-md px-2 py-1 text-[12px]" style={{ background: 'var(--danger-50)', color: '#8C1B28' }}>
              {error}
            </span>
          )}
          <div className="flex-1" />
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!title.trim() || create.isPending}>
            {t('newReq.create')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Requirement detail drawer                                          */
/* ------------------------------------------------------------------ */
function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[30px] items-center gap-2.5">
      <span className="w-[72px] flex-none text-[12.5px] text-fg-3">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
const propBtn =
  'inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2 py-1 text-[13px] text-fg-1 hover:bg-surface-2';
const selCls =
  'w-full rounded-[7px] border border-transparent bg-transparent px-2 py-1 text-[13px] text-fg-1 hover:bg-surface-2 focus:border-brand-blue focus:bg-surface outline-none';

/* Confirm + result dialog for "decompose into issues". The preview mirrors the
   server-side split (src/lib/decompose.ts); on success the created issue keys
   are shown and the linked-issue list refreshes via the mutation's
   invalidation. */
function DecomposeDialog({
  req,
  open,
  onOpenChange,
}: {
  req: Requirement;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useT();
  const decompose = useDecomposeRequirement();
  const [error, setError] = React.useState<string | null>(null);
  const [createdKeys, setCreatedKeys] = React.useState<string[] | null>(null);
  const items = decompositionItemsFor(req);
  const preview = items.slice(0, 5);

  // Reset the result/error on close so the next open starts from the preview.
  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setError(null);
      setCreatedKeys(null);
    }
    onOpenChange(o);
  };

  const submit = async () => {
    if (decompose.isPending) return;
    setError(null);
    try {
      const issues = await decompose.mutateAsync(req.id);
      setCreatedKeys(issues.map((i) => i.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('requirements.decomposeFailed'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogPrimitive.Title className="px-[18px] pb-1 pt-4 text-[15px] font-semibold text-fg-1">
          {t('requirements.decompose')}
        </DialogPrimitive.Title>
        <div className="flex flex-col gap-2 px-[18px] py-3">
          {createdKeys ? (
            <>
              <div className="text-[13px] text-fg-1">{t('requirements.decomposeDone', { n: createdKeys.length })}</div>
              <div className="flex flex-wrap gap-1.5">
                {createdKeys.map((k) => (
                  <span key={k} className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[12px] text-fg-2">
                    {k}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="text-[13px] text-fg-1">{t('requirements.decomposeBody', { n: items.length })}</div>
              <ul className="flex flex-col gap-1">
                {preview.map((item, i) => (
                  <li key={i} className="flex gap-2 text-[13px] leading-normal text-fg-1">
                    <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-brand-blue" />
                    {item}
                  </li>
                ))}
              </ul>
              {items.length > preview.length && (
                <div className="text-[12px] text-fg-3">{t('requirements.decomposeMore', { n: items.length })}</div>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
          {error && (
            <span
              className="truncate rounded-md px-2 py-1 text-[12px]"
              style={{ background: 'var(--danger-50)', color: '#8C1B28' }}
            >
              {error}
            </span>
          )}
          <div className="flex-1" />
          {createdKeys ? (
            <Button variant="primary" size="md" onClick={() => handleOpenChange(false)}>
              {t('common.ok')}
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="md" onClick={() => handleOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" size="md" onClick={submit} disabled={decompose.isPending}>
                {t('requirements.decomposeConfirm')}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RequirementDetail({
  id,
  onClose,
  onOpenIssue,
}: {
  id: string;
  onClose: () => void;
  onOpenIssue: (key: string) => void;
}) {
  const t = useT();
  const { projectById, memberById, releases, productById } = useAppData();
  const { data: req } = useRequirement(id);
  const { data: allIssues = [] } = useAllIssues();
  const update = useUpdateRequirement();
  const del = useDeleteRequirement();
  const [decompOpen, setDecompOpen] = React.useState(false);

  const [title, setTitle] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [acceptance, setAcceptance] = React.useState('');
  React.useEffect(() => {
    if (req) {
      setTitle(req.title);
      setDesc(req.description ?? '');
      setAcceptance(req.acceptanceCriteria ?? '');
    }
  }, [req?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  if (!req) return null;
  const patch = (input: Parameters<typeof update.mutate>[0]['input']) => update.mutate({ id, input });
  const project = projectById(req.projectId);
  const author = memberById(req.authorId);
  const aiOwner = memberById(req.aiOwnerId);
  const linked = req.issues.map((k) => allIssues.find((i) => i.id === k)).filter(Boolean) as typeof allIssues;
  const acceptanceLines = (req.acceptanceCriteria ?? '').split('\n').map((s) => s.trim()).filter(Boolean);

  const saveIf = (field: 'title' | 'description' | 'acceptanceCriteria', value: string) => {
    const orig = field === 'title' ? req.title : field === 'description' ? req.description ?? '' : req.acceptanceCriteria ?? '';
    if (value.trim() !== (orig ?? '').trim()) {
      patch({ [field]: field === 'title' ? value.trim() : value.trim() || null } as never);
    }
  };

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[800] animate-fadeIn bg-[rgba(11,18,32,0.35)]" />
      <div className="fixed inset-y-0 right-0 z-[810] flex w-[min(760px,92vw)] animate-slideIn flex-col border-l border-border bg-surface shadow-4">
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-border px-[18px] py-3">
          <FileText size={15} className="text-fg-3" />
          <span className="flex-none whitespace-nowrap font-mono text-[12.5px] text-fg-3">{req.id}</span>
          <TypeTag type={req.type} />
          {req.category && <Badge tone="neutral">{t(`reqCategory.${req.category}`)}</Badge>
          }
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDecompOpen(true)}
            disabled={decompositionItemsFor(req).length === 0}
            aria-label="decompose"
            title={t('requirements.decompose')}
          >
            <ListTree size={15} />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => del.mutate(req.id, { onSuccess: onClose })} aria-label="delete">
            <Trash2 size={15} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="close">
            <X size={16} />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Main column */}
          <div className="min-w-0 flex-1 overflow-y-auto px-7 py-6">
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => saveIf('title', title)}
              rows={1}
              className="mb-3 w-full resize-none border-0 bg-transparent text-[21px] font-semibold leading-snug tracking-tight text-fg-1 outline-none"
            />

            {/* AI owner (Atlas maintains PRD) */}
            {aiOwner && (
              <div
                className="mb-[18px] flex items-center gap-2.5 rounded-xl p-3"
                style={{ border: '1px solid var(--xgent-orange-200)', background: 'var(--xgent-orange-50)' }}
              >
                <Avatar person={aiOwner} size={26} />
                <div className="flex-1">
                  <div className="text-[12.5px] font-semibold text-brand-orange">
                    <Sparkles size={11} className="mb-0.5 mr-0.5 inline" />
                    {t('requirements.maintainedByAI', { name: aiOwner.name })}
                  </div>
                </div>
                <Badge tone="orange" dot>
                  {t('detail.running')}
                </Badge>
              </div>
            )}

            <div className="mb-1.5 text-[12.5px] font-semibold text-fg-2">{t('requirements.prd')}</div>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              onBlur={() => saveIf('description', desc)}
              rows={Math.max(3, desc.split('\n').length)}
              placeholder={t('requirements.noDesc')}
              className="mb-[22px] w-full resize-none rounded-[9px] border border-transparent bg-transparent px-0 text-sm leading-relaxed text-fg-1 outline-none placeholder:text-fg-3 hover:border-border focus:border-brand-blue focus:px-2.5 focus:py-2"
            />

            <div className="mb-1.5 text-[12.5px] font-semibold text-fg-2">{t('requirements.acceptance')}</div>
            {acceptanceLines.length > 0 && (
              <ul className="mb-2 flex flex-col gap-1">
                {acceptanceLines.map((line, i) => (
                  <li key={i} className="flex gap-2 text-[13px] leading-normal text-fg-1">
                    <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-brand-blue" />
                    {line.replace(/^\d+\.\s*/, '')}
                  </li>
                ))}
              </ul>
            )}
            <textarea
              value={acceptance}
              onChange={(e) => setAcceptance(e.target.value)}
              onBlur={() => saveIf('acceptanceCriteria', acceptance)}
              rows={2}
              placeholder={t('requirements.noAcceptance')}
              className="mb-[22px] w-full resize-none rounded-[9px] border border-transparent bg-transparent text-[12.5px] leading-relaxed text-fg-3 outline-none placeholder:text-fg-3 hover:border-border focus:border-brand-blue focus:px-2.5 focus:py-2 focus:text-fg-1"
            />

            {/* Linked issues */}
            <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-fg-2">
              <GitBranch size={14} className="text-fg-3" /> {t('requirements.linkedIssues')} ·{' '}
              {req.issueStats.done}/{req.issueStats.total}
            </div>
            {linked.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-border px-3 py-4 text-center text-[12.5px] text-fg-3">
                {t('requirements.noLinked')}
              </div>
            ) : (
              <div className="overflow-hidden rounded-[10px] border border-border">
                {linked.map((i) => (
                  <div
                    key={i.id}
                    onClick={() => onOpenIssue(i.id)}
                    className="flex cursor-pointer items-center gap-2.5 border-b border-border px-3 py-2 last:border-b-0 hover:bg-surface-2"
                  >
                    <StatusIcon status={i.status} size={15} />
                    <span className="flex-none whitespace-nowrap font-mono text-[11.5px] text-fg-3">{i.id}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-fg-1">{i.title}</span>
                    <PriorityIcon priority={i.priority} size={14} />
                    <ImportanceIcon importance={i.importance} size={14} />
                    <Avatar person={memberById(i.assigneeId)} size={18} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Properties column */}
          <div className="w-[236px] flex-none overflow-y-auto border-l border-border bg-surface px-4 py-5">
            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
              {t('detail.props')}
            </div>
            <div className="flex flex-col gap-1.5">
              <PropRow label={t('requirements.type')}>
                <select
                  className={selCls}
                  value={req.type}
                  onChange={(e) => patch({ type: e.target.value as RequirementType })}
                >
                  {TYPE_ORDER.map((ty) => (
                    <option key={ty} value={ty}>
                      {t(`reqType.${ty}`)}
                    </option>
                  ))}
                </select>
              </PropRow>
              {req.type === 'non_functional' && (
                <PropRow label={t('requirements.category')}>
                  <select
                    className={selCls}
                    value={req.category ?? 'performance'}
                    onChange={(e) => patch({ category: e.target.value as RequirementCategory })}
                  >
                    {REQUIREMENT_CATEGORY_ORDER.map((c) => (
                      <option key={c} value={c}>
                        {t(`reqCategory.${c}`)}
                      </option>
                    ))}
                  </select>
                </PropRow>
              )}
              <PropRow label={t('requirements.status')}>
                <select
                  className={selCls}
                  value={req.status}
                  onChange={(e) => patch({ status: e.target.value as RequirementStatus })}
                >
                  {REQUIREMENT_STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {t(`reqStatus.${s}`)}
                    </option>
                  ))}
                </select>
              </PropRow>
              <PropRow label={t('requirements.priority')}>
                <PriorityMenu
                  current={req.priority}
                  onPick={(p) => patch({ priority: p })}
                  trigger={
                    <button className={propBtn}>
                      <PriorityIcon priority={req.priority} size={16} /> {t(`priority.${req.priority}`)}
                    </button>
                  }
                />
              </PropRow>
              <PropRow label={t('requirements.importance')}>
                <ImportanceMenu
                  current={req.importance}
                  onPick={(p) => patch({ importance: p })}
                  trigger={
                    <button className={propBtn}>
                      <ImportanceIcon importance={req.importance} size={16} /> {t(`importance.${req.importance}`)}
                    </button>
                  }
                />
              </PropRow>
            </div>

            <div className="my-4 h-px bg-border" />
            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
              {t('requirements.project')}
            </div>
            {project && (
              <div className="mb-2 flex items-center gap-2 px-2 py-1">
                <span className="grid h-5 w-5 place-items-center rounded-md" style={{ background: project.color }}>
                  <ProjectIcon name={project.icon} size={12} />
                </span>
                <span className="truncate text-[13px] text-fg-1">{project.name}</span>
              </div>
            )}
            <PropRow label={t('requirements.release')}>
              <select
                className={selCls}
                value={req.releaseId ?? ''}
                onChange={(e) => patch({ releaseId: e.target.value || null })}
              >
                <option value="">{t('requirements.noRelease')}</option>
                {releases.map((r) => (
                  <option key={r.id} value={r.id}>
                    {productById(r.productId)?.name ?? ''} · {r.name}
                  </option>
                ))}
              </select>
            </PropRow>

            <div className="my-4 h-px bg-border" />
            <PropRow label={t('requirements.author')}>
              <span className="inline-flex items-center gap-2 px-2 py-1">
                <Avatar person={author} size={20} /> <span className="text-[13px] text-fg-1">{author?.name ?? '—'}</span>
              </span>
            </PropRow>
            {aiOwner && (
              <PropRow label={t('requirements.aiOwner')}>
                <span className="inline-flex items-center gap-2 px-2 py-1">
                  <Avatar person={aiOwner} size={20} /> <span className="text-[13px] text-fg-1">{aiOwner.name}</span>
                </span>
              </PropRow>
            )}
          </div>
        </div>
      </div>
      <DecomposeDialog req={req} open={decompOpen} onOpenChange={setDecompOpen} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Requirements list view                                             */
/* ------------------------------------------------------------------ */
/* Quick-change requirement status from the list without opening the drawer. */
function ReqStatusMenu({ value, onPick }: { value: RequirementStatus; onPick: (s: RequirementStatus) => void }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button onClick={(e) => e.stopPropagation()}>
          <Badge tone={REQUIREMENT_STATUS[value].tone} dot>{t(`reqStatus.${value}`)}</Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[140px]" onClick={(e) => e.stopPropagation()}>
        {REQUIREMENT_STATUS_ORDER.map((s) => (
          <MenuItem key={s} label={t(`reqStatus.${s}`)} selected={s === value} onClick={() => { onPick(s); setOpen(false); }} />
        ))}
      </PopoverContent>
    </Popover>
  );
}

function ReqRow({ req, onOpen }: { req: Requirement; onOpen: (id: string) => void }) {
  const t = useT();
  const { memberById } = useAppData();
  const update = useUpdateRequirement();
  const aiOwner = memberById(req.aiOwnerId);
  const pct = req.issueStats.total ? Math.round((req.issueStats.done / req.issueStats.total) * 100) : 0;
  return (
    <div
      onClick={() => onOpen(req.id)}
      className="flex h-[42px] cursor-pointer items-center gap-2.5 border-b border-border px-5 transition-colors hover:bg-surface-2"
    >
      <span className="w-[56px] flex-none font-mono text-xs text-fg-3">{req.id}</span>
      <EditableTitle value={req.title} onSave={(title) => update.mutate({ id: req.id, input: { title } })} className="min-w-0 flex-1 text-[13.5px] text-fg-1" />
      {req.category && <Badge tone="neutral">{t(`reqCategory.${req.category}`)}</Badge>}
      <PriorityIcon priority={req.priority} size={15} />
      <ImportanceIcon importance={req.importance} size={15} />
      {req.issueStats.total > 0 && (
        <span className="hidden w-[88px] flex-none items-center gap-1.5 sm:inline-flex">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
            <span className="block h-full rounded-full bg-brand-blue" style={{ width: `${pct}%` }} />
          </span>
          <span className="font-mono text-[10.5px] text-fg-3">
            {req.issueStats.done}/{req.issueStats.total}
          </span>
        </span>
      )}
      <ReqStatusMenu value={req.status} onPick={(status) => update.mutate({ id: req.id, input: { status } })} />
      {aiOwner && <Avatar person={aiOwner} size={20} />}
    </div>
  );
}

/* The drawer is URL-driven (/requirements/<KEY>) by the page wrapper; linked issues
   jump to /issues/<KEY>. */
export function RequirementsView({
  project,
  selected,
  onSelect,
}: {
  project?: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const t = useT();
  const router = useRouter();
  const { projects, projectById, can } = useAppData();
  const canWrite = can('requirements', 'write');
  const [projectFilter, setProjectFilter] = React.useState(project ?? '');
  // Follow an external ?project= change (e.g. arriving from a project hub tab).
  React.useEffect(() => {
    if (project != null) setProjectFilter(project);
  }, [project]);
  const [typeTab, setTypeTab] = usePersistentState<RequirementType>('requirements.typeTab', 'functional', isTypeTab);
  const [statusFilter, setStatusFilter] = usePersistentState<StatusFilter>('requirements.statusFilter', 'draft', isStatusFilter);
  const [q, setQ] = React.useState('');
  const { data: requirements = [] } = useRequirements(projectFilter ? { project: projectFilter } : undefined);
  const create = useCreateRequirement();
  const [newOpen, setNewOpen] = React.useState(false);

  const counts: Record<RequirementType, number> = {
    functional: requirements.filter((r) => r.type === 'functional').length,
    non_functional: requirements.filter((r) => r.type === 'non_functional').length,
  };
  const list = requirements
    .filter((r) => r.type === typeTab)
    .filter((r) => (statusFilter ? r.status === statusFilter : true))
    .filter((r) => (q ? (r.title + r.id).toLowerCase().includes(q.toLowerCase()) : true));

  const targetProject = projectFilter || projects[0]?.id || '';
  const quickCreate = (title: string) => {
    if (!targetProject) return;
    create.mutate({ projectId: targetProject, title, type: typeTab, status: 'draft', releaseId: projectById(targetProject)?.releaseId ?? null });
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* toolbar */}
      <div className="flex flex-col gap-2.5 border-b border-border px-6 pt-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="m-0 text-[18px] font-semibold tracking-tight text-fg-1">{t('requirements.title')}</h1>
          <span className="rounded-full bg-surface-2 px-2.5 py-px text-[12.5px] font-semibold text-fg-3">{requirements.length}</span>
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
              <Plus size={14} /> {t('requirements.new')}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* type tabs — functional / non-functional */}
          <div className="flex items-center gap-4">
            {TYPE_ORDER.map((ty) => (
              <TabBtn key={ty} active={typeTab === ty} onClick={() => setTypeTab(ty)}>
                <span className="h-2 w-2 rounded-full" style={{ background: REQUIREMENT_TYPE[ty].color }} />
                {t(`reqType.${ty}`)}
                <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-semibold text-fg-3">{counts[ty]}</span>
              </TabBtn>
            ))}
          </div>
          <div className="flex-1" />
          {/* status segmented toggle (defaults to 草稿) */}
          <div className="inline-flex items-center gap-0.5 overflow-x-auto rounded-lg bg-surface-2 p-0.5">
            <SegBtn active={statusFilter === ''} onClick={() => setStatusFilter('')}>{t('common.all')}</SegBtn>
            {REQUIREMENT_STATUS_ORDER.map((s) => (
              <SegBtn key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>{t(`reqStatus.${s}`)}</SegBtn>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {canWrite && (
          <InlineCreateRow label={t('requirements.new')} onCreate={quickCreate} className="border-b border-border" />
        )}
        {list.length === 0 ? (
          <div className="grid h-[40vh] place-items-center text-[13px] text-fg-3">{t('requirements.empty')}</div>
        ) : (
          list.map((req) => <ReqRow key={req.id} req={req} onOpen={onSelect} />)
        )}
      </div>

      {selected && (
        <RequirementDetail
          id={selected}
          onClose={() => onSelect(null)}
          onOpenIssue={(key) => router.push(`/issues/${encodeURIComponent(key)}`)}
        />
      )}
      <NewRequirementModal
        open={newOpen}
        onOpenChange={setNewOpen}
        defaultProject={projectFilter || projectById(project ?? '')?.id}
        onCreated={onSelect}
      />
    </div>
  );
}
