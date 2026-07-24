'use client';

import * as React from 'react';
import { X, Link2, MoreHorizontal, GitBranch, Target, Eye, CornerDownLeft, Check, FileText, ChevronRight, Box, Layers, Trash2, Plus, Paperclip, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverTrigger, PopoverContent, MenuItem } from '@/components/ui/popover';
import { StatusIcon } from '@/components/glyphs/StatusIcon';
import { PriorityIcon } from '@/components/glyphs/PriorityIcon';
import { ImportanceIcon } from '@/components/glyphs/ImportanceIcon';
import { TypeIcon } from '@/components/glyphs/TypeIcon';
import { Avatar } from '@/components/glyphs/Avatar';
import { AISlaBadge, LabelChip, ProjectIcon } from '@/components/glyphs/misc';
import { TypeMenu, StatusMenu, PriorityMenu, ImportanceMenu, ScopedAssigneeMenu, RequirementMenu, LabelMenu } from '@/components/menus';
import { useT, useLocale } from '@/lib/i18n';
import { formatActivityTime } from '@/lib/time';
import { useAppData } from '@/store/AppData';
import { useIssue, useUpdateIssue, useAddComment, useToggleSub, useDeleteIssue, useRegisterAttachment, useDeleteAttachment } from '@/store/issues';
import { useIssueCandidates } from '@/store/resources';
import { useRequirements } from '@/store/requirements';
import { uploadImage } from '@/lib/upload';
import type { Activity, IssueStatus, Member } from '@/lib/types';

function ActivityItem({ ev }: { ev: Activity }) {
  const t = useT();
  const locale = useLocale();
  const { memberById } = useAppData();
  const who = memberById(ev.whoId);
  const isAI = ev.kind === 'ai';
  const isComment = ev.kind === 'comment';
  return (
    <div className="flex gap-2.5 py-2">
      <div className="mt-px flex-none">
        <Avatar person={who} size={22} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] leading-normal text-fg-2">
          <span className="font-semibold text-fg-1">{who?.name ?? t('detail.system')}</span>{' '}
          {!isComment && !isAI && ev.body}
          {isAI && <span className="font-medium text-brand-orange"> {ev.body}</span>}
        </div>
        {isComment && (
          <div className="mt-1.5 rounded-[9px] bg-surface-2 px-3 py-2 text-[13px] leading-normal text-fg-1">
            {ev.body}
          </div>
        )}
        <div className="mt-0.5 text-[11px] text-fg-3">{formatActivityTime(ev.createdAt, locale)}</div>
      </div>
    </div>
  );
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[30px] items-center gap-2.5">
      <span className="w-[76px] flex-none text-[12.5px] text-fg-3">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const propBtn =
  'inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2 py-1 text-[13px] text-fg-1 hover:bg-surface-2';

/* Comment box with @-mention autocomplete over the issue's project research
   members. Typing "@" opens a picker; choosing a name inserts "@Name " inline. */
function CommentBox({ candidates, me, onSubmit }: { candidates: Member[]; me: Member | null | undefined; onSubmit: (text: string) => void }) {
  const t = useT();
  const [value, setValue] = React.useState('');
  // active @-mention: the query text + where the "@" sits in `value`
  const [mention, setMention] = React.useState<{ query: string; at: number } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const humans = candidates.filter((m) => m.type === 'human');
  const matches = mention
    ? humans.filter((h) => h.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6)
    : [];

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setValue(v);
    const caret = e.target.selectionStart ?? v.length;
    // an @-token is "@" preceded by start/space, with no space/@ after it
    const m = v.slice(0, caret).match(/(?:^|\s)@([^\s@]*)$/);
    setMention(m ? { query: m[1], at: caret - m[1].length - 1 } : null);
  };

  const pick = (name: string) => {
    if (!mention) return;
    const caret = inputRef.current?.selectionStart ?? value.length;
    const next = `${value.slice(0, mention.at)}@${name} ${value.slice(caret)}`;
    setValue(next);
    setMention(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    onSubmit(text);
    setValue('');
    setMention(null);
  };

  return (
    <div className="flex items-start gap-2.5">
      <Avatar person={me} size={22} />
      <div className="relative flex-1">
        {mention && matches.length > 0 && (
          <div className="absolute bottom-[calc(100%+6px)] left-0 z-[820] w-[244px] overflow-hidden rounded-[10px] border border-border bg-surface p-1.5 shadow-3">
            <div className="px-2.5 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
              {t('detail.mention')}
            </div>
            {matches.map((h) => (
              <div
                key={h.id}
                // mousedown (not click) so the input doesn't blur before we insert
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  pick(h.name);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-fg-1 hover:bg-surface-2"
              >
                <Avatar person={h} size={18} /> {h.name}
              </div>
            ))}
          </div>
        )}
        <input
          ref={inputRef}
          value={value}
          onChange={onChange}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && mention) {
              e.stopPropagation();
              setMention(null);
            } else if (e.key === 'Enter' && !mention) {
              submit();
            }
          }}
          placeholder={t('detail.commentPlaceholder')}
          className="h-[38px] w-full rounded-[9px] border border-border-strong bg-surface px-3 text-[13px] text-fg-1 outline-none focus:border-brand-blue"
        />
      </div>
    </div>
  );
}

export function IssueDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { memberById, projectById, labelById, sprintById, me, labelByKey, releaseById, productById, productLineById } = useAppData();
  const t = useT();
  const { data: issue } = useIssue(id);
  const update = useUpdateIssue();
  const addComment = useAddComment();
  const toggleSub = useToggleSub();
  const del = useDeleteIssue();
  const registerAttachment = useRegisterAttachment();
  const deleteAttachment = useDeleteAttachment();
  // In-flight uploads (blob uploaded, registration pending) — shown as dimmed tiles.
  const [uploading, setUploading] = React.useState<{ key: string; preview: string }[]>([]);
  const attachInputRef = React.useRef<HTMLInputElement>(null);
  const { data: projectReqs = [] } = useRequirements(issue?.projectId ? { project: issue.projectId } : undefined);
  // Assignee + @-mention pool: the issue's project research resources (+ AI agents).
  const { data: candData } = useIssueCandidates(id);
  const [tab, setTab] = React.useState<'activity' | 'comments'>('activity');
  const [copied, setCopied] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);

  React.useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  if (!issue) return null;

  const assignee = memberById(issue.assigneeId);
  const project = projectById(issue.projectId);
  const sprint = sprintById(issue.sprintId);
  const requirement = projectReqs.find((r) => r.id === issue.requirementId);
  const release = releaseById(project?.releaseId);
  const product = productById(release?.productId);
  const productLine = productLineById(product?.productLineId);
  const labels = issue.labels.map((l) => labelById(l)).filter(Boolean) as { id: string; name: string; color: string }[];
  const docsLabel = labelByKey('docs');
  const isPRD = !!docsLabel && issue.labels.includes(docsLabel.id) && issue.aiAssigned;
  const patch = (p: Parameters<typeof update.mutate>[0]['input']) => update.mutate({ id, input: p });
  const candidates = candData?.candidates ?? [];

  // Upload each picked image straight to Blob, then register it on the issue.
  const addFiles = (files: Iterable<File>) => {
    for (const file of files) {
      const key = crypto.randomUUID();
      setUploading((u) => [...u, { key, preview: URL.createObjectURL(file) }]);
      uploadImage(file)
        .then((meta) =>
          registerAttachment.mutate(
            { id, meta },
            { onSettled: () => setUploading((u) => u.filter((x) => x.key !== key)) },
          ),
        )
        .catch(() => setUploading((u) => u.filter((x) => x.key !== key)));
    }
  };

  // Paste an image anywhere in the panel to attach it (same as 添加图片).
  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const removeAttachment = (attachmentId: string) => {
    if (window.confirm(t('issue.confirmDeleteAttachment'))) {
      deleteAttachment.mutate({ id, attachmentId });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  // Share = a URL deep link that opens this very issue's drawer (/issues?selected=<KEY>).
  const shareUrl =
    typeof window === 'undefined'
      ? `/issues?selected=${encodeURIComponent(issue.id)}`
      : `${window.location.origin}/issues?selected=${encodeURIComponent(issue.id)}`;
  const copyLink = () => copyToClipboard(shareUrl);
  const copyId = () => copyToClipboard(issue.id);

  const aiSteps = isPRD
    ? [t('detail.aiPRD1'), t('detail.aiPRD2'), t('detail.aiPRD3')]
    : [t('detail.aiCode1'), t('detail.aiCode2'), t('detail.aiCode3')];

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[800] animate-fadeIn bg-[rgba(11,18,32,0.35)]"
      />
      <div
        onPaste={onPaste}
        className="fixed inset-y-0 right-0 z-[810] flex w-[min(760px,92vw)] animate-slideIn flex-col border-l border-border bg-surface shadow-4"
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-border px-[18px] py-3">
          <span className="flex-none whitespace-nowrap font-mono text-[12.5px] text-fg-3">
            {issue.id}
          </span>
          <div className="flex-1" />
          <Button variant="ghost" size="icon" aria-label={t('detail.copyLink')} title={t('detail.copyLink')} onClick={copyLink}>
            {copied ? <Check size={16} className="text-success" /> : <Link2 size={16} />}
          </Button>
          <Popover open={moreOpen} onOpenChange={setMoreOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('detail.more')}>
                <MoreHorizontal size={16} />
              </Button>
            </PopoverTrigger>
            <PopoverContent style={{ width: 184 }} align="end">
              <MenuItem
                glyph={<Link2 size={15} className="text-fg-3" />}
                label={t('detail.copyId')}
                onClick={() => {
                  copyId();
                  setMoreOpen(false);
                }}
              />
              <MenuItem
                glyph={<Trash2 size={15} className="text-danger" />}
                label={t('detail.deleteIssue')}
                onClick={() => {
                  setMoreOpen(false);
                  del.mutate(id, { onSuccess: onClose });
                }}
              />
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="close">
            <X size={16} />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Main column */}
          <div className="min-w-0 flex-1 overflow-y-auto px-7 py-6">
            <div className="mb-3.5 flex items-start gap-2.5">
              <div className="mt-1">
                <StatusIcon status={issue.status} size={20} />
              </div>
              <h1 className="m-0 text-[21px] font-semibold leading-snug tracking-tight text-fg-1">
                {issue.title}
              </h1>
            </div>

            {(labels.length > 0 || issue.aiAssigned) && (
              <div className="mb-[18px] flex flex-wrap gap-1.5">
                {issue.aiAssigned && <AISlaBadge />}
                {labels.map((l) => (
                  <LabelChip key={l.id} label={l} />
                ))}
              </div>
            )}

            <div className="mb-[22px] text-sm leading-relaxed text-fg-1">
              {issue.description || t('detail.noDesc')}
            </div>

            {/* Attachments */}
            <div className="mb-[22px]">
              <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-fg-2">
                <Paperclip size={14} className="text-fg-3" /> {t('issue.attachments')}
                {issue.attachments.length > 0 && <> · {issue.attachments.length}</>}
                <div className="flex-1" />
                <button
                  onClick={() => attachInputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-[7px] px-2 py-1 text-[12.5px] font-medium text-fg-2 hover:bg-surface-2"
                >
                  <Plus size={13} className="text-fg-3" /> {t('issue.attachImage')}
                </button>
              </div>
              {(issue.attachments.length > 0 || uploading.length > 0) && (
                <div className="flex flex-wrap gap-2">
                  {issue.attachments.map((a) => (
                    <div
                      key={a.id}
                      title={a.filename}
                      className="group relative h-16 w-16 overflow-hidden rounded-lg border border-border"
                    >
                      <a href={a.url} target="_blank" rel="noreferrer">
                        <img src={a.url} alt={a.filename} className="h-full w-full object-cover" />
                      </a>
                      <button
                        onClick={() => removeAttachment(a.id)}
                        aria-label="delete"
                        className="absolute right-0.5 top-0.5 hidden h-4 w-4 place-items-center rounded-full bg-black/55 text-white hover:bg-black/75 group-hover:grid"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                  {uploading.map((u) => (
                    <div key={u.key} className="relative h-16 w-16 overflow-hidden rounded-lg border border-border">
                      <img src={u.preview} alt="" className="h-full w-full object-cover opacity-60" />
                      <div className="absolute inset-0 grid place-items-center">
                        <Loader2 size={16} className="animate-spin text-fg-2" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <input
                ref={attachInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>

            {/* AI agent workspace card */}
            {issue.aiAssigned && assignee && (
              <div
                className="mb-[22px] rounded-xl p-4"
                style={{ border: '1px solid var(--xgent-orange-200)', background: 'var(--xgent-orange-50)' }}
              >
                <div className="mb-3 flex items-center gap-2.5">
                  <Avatar person={assignee} size={28} />
                  <div className="flex-1">
                    <div className="whitespace-nowrap text-[13.5px] font-semibold text-fg-1">
                      {assignee.name}
                    </div>
                    <div className="text-[11.5px] font-semibold text-brand-orange">
                      {isPRD ? t('detail.aiPRD') : t('detail.aiRunning')}
                    </div>
                  </div>
                  <Badge tone="orange" dot>
                    {t('detail.running')}
                  </Badge>
                </div>
                <div className="flex flex-col gap-2">
                  {aiSteps.map((step, i, arr) => (
                    <div key={i} className="flex items-center gap-2.5 text-[12.5px] text-fg-2">
                      {i < arr.length - 1 ? (
                        <Check size={14} className="text-success" />
                      ) : (
                        <span className="ai-pulse grid h-3.5 w-3.5 place-items-center">
                          <span className="h-[7px] w-[7px] rounded-full bg-brand-orange" />
                        </span>
                      )}
                      <span
                        className={i < arr.length - 1 ? 'text-fg-3 line-through' : 'text-fg-1'}
                      >
                        {step}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3.5 flex gap-2">
                  <Button variant="accent" size="sm">
                    <Eye size={14} /> {t('detail.viewTrace')}
                  </Button>
                  <Button variant="secondary" size="sm">
                    <CornerDownLeft size={14} /> {isPRD ? t('detail.requestRewrite') : t('detail.requestRerun')}
                  </Button>
                </div>
              </div>
            )}

            {/* Sub-issues */}
            {issue.subIssues.length > 0 && (
              <div className="mb-[22px]">
                <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-fg-2">
                  <GitBranch size={14} className="text-fg-3" /> {t('detail.subtasks')} ·{' '}
                  {issue.subIssues.filter((s) => s.status === 'done').length}/{issue.subIssues.length}
                  <div className="ml-1.5 h-1 flex-1 rounded-full bg-surface-sunken">
                    <div
                      className="h-full rounded-full bg-brand-blue"
                      style={{
                        width: `${(issue.subIssues.filter((s) => s.status === 'done').length / issue.subIssues.length) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                {issue.subIssues.map((s) => {
                  const done = s.status === 'done';
                  return (
                    <div
                      key={s.id}
                      className="flex items-center gap-2.5 border-b border-border py-1.5"
                    >
                      <button
                        onClick={() =>
                          toggleSub.mutate({
                            id,
                            subId: s.id,
                            status: done ? 'todo' : 'done',
                          })
                        }
                      >
                        <StatusIcon status={done ? 'done' : 'todo'} size={15} />
                      </button>
                      <span className="flex-none whitespace-nowrap font-mono text-[11.5px] text-fg-3">
                        {s.id}
                      </span>
                      <span
                        className={
                          done ? 'text-[13px] text-fg-3 line-through' : 'text-[13px] text-fg-1'
                        }
                      >
                        {s.title}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Activity / comments */}
            <div className="mb-1.5 flex gap-4 border-b border-border">
              {(
                [
                  ['activity', t('detail.activity')],
                  ['comments', `${t('detail.comments')} ${issue.commentsCount}`],
                ] as ['activity' | 'comments', string][]
              ).map(([k, l]) => (
                <div
                  key={k}
                  onClick={() => setTab(k)}
                  className="-mb-px cursor-pointer pb-2 text-[13px]"
                  style={{
                    fontWeight: tab === k ? 600 : 500,
                    color: tab === k ? 'var(--fg-1)' : 'var(--fg-3)',
                    borderBottom: tab === k ? '2px solid var(--brand-blue)' : '2px solid transparent',
                  }}
                >
                  {l}
                </div>
              ))}
            </div>
            <div className="mb-4">
              {issue.activities
                .filter((a) => (tab === 'comments' ? a.kind === 'comment' || a.kind === 'ai' : true))
                .map((ev) => (
                  <ActivityItem key={ev.id} ev={ev} />
                ))}
            </div>
            <CommentBox candidates={candidates} me={me} onSubmit={(text) => addComment.mutate({ id, body: text })} />
          </div>

          {/* Properties column */}
          <div className="w-[232px] flex-none overflow-y-auto border-l border-border bg-surface px-4 py-5">
            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
              {t('detail.props')}
            </div>
            <div className="flex flex-col gap-1">
              <PropRow label={t('detail.type')}>
                <TypeMenu
                  current={issue.type}
                  onPick={(ty) => patch({ type: ty })}
                  trigger={
                    <button className={propBtn}>
                      <TypeIcon type={issue.type} size={16} /> {t(`type.${issue.type}`)}
                    </button>
                  }
                />
              </PropRow>
              <PropRow label={t('detail.status')}>
                <StatusMenu
                  current={issue.status}
                  onPick={(s) => patch({ status: s })}
                  trigger={
                    <button className={propBtn}>
                      <StatusIcon status={issue.status} size={16} /> {t(`status.${issue.status}`)}
                    </button>
                  }
                />
              </PropRow>
              <PropRow label={t('detail.priority')}>
                <PriorityMenu
                  current={issue.priority}
                  onPick={(p) => patch({ priority: p })}
                  trigger={
                    <button className={propBtn}>
                      <PriorityIcon priority={issue.priority} size={16} />{' '}
                      {t(`priority.${issue.priority}`)}
                    </button>
                  }
                />
              </PropRow>
              <PropRow label={t('detail.importance')}>
                <ImportanceMenu
                  current={issue.importance}
                  onPick={(p) => patch({ importance: p })}
                  trigger={
                    <button className={propBtn}>
                      <ImportanceIcon importance={issue.importance} size={16} />{' '}
                      {t(`importance.${issue.importance}`)}
                    </button>
                  }
                />
              </PropRow>
              <PropRow label={t('detail.assignee')}>
                <ScopedAssigneeMenu
                  candidates={candidates}
                  current={issue.assigneeId}
                  onPick={(a) => patch({ assigneeId: a })}
                  emptyHint={issue.projectId ? t('detail.noResources') : t('detail.assignNeedsProject')}
                  trigger={
                    <button className={propBtn}>
                      <Avatar person={assignee} size={20} /> {assignee ? assignee.name : t('common.unassigned')}
                    </button>
                  }
                />
              </PropRow>
              {issue.estimate != null && (
                <PropRow label={t('detail.estimate')}>
                  <span className="px-2 py-1 text-[13px] text-fg-1">{t('detail.pts', { n: issue.estimate })}</span>
                </PropRow>
              )}
              {issue.storyPoints != null && (
                <PropRow label={t('detail.points')}>
                  <span className="inline-flex items-center gap-1.5 px-2 py-1">
                    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-blue/10 px-1.5 text-[11px] font-semibold text-brand-blue">
                      {issue.storyPoints}
                    </span>
                  </span>
                </PropRow>
              )}
            </div>

            <div className="my-4 h-px bg-border" />
            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
              {t('detail.belong')}
            </div>
            {project && (
              <div className="mb-0.5 flex items-center gap-2 px-2 py-1.5">
                <span
                  className="grid h-5 w-5 place-items-center rounded-md"
                  style={{ background: project.color }}
                >
                  <ProjectIcon name={project.icon} size={12} />
                </span>
                <span className="text-[13px] text-fg-1">{project.name}</span>
              </div>
            )}
            {/* Requirement (PRD) link — scoped to this issue's project */}
            <RequirementMenu
              projectId={issue.projectId}
              current={issue.requirementId}
              onPick={(r) => patch({ requirementId: r })}
              trigger={
                <button className="flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left hover:bg-surface-2">
                  <FileText size={16} className="flex-none text-fg-3" />
                  {requirement ? (
                    <span className="min-w-0 flex-1 truncate text-[13px] text-fg-1">{requirement.title}</span>
                  ) : issue.requirementId ? (
                    <span className="font-mono text-[12.5px] text-fg-1">{issue.requirementId}</span>
                  ) : (
                    <span className="text-[13px] text-fg-3">{t('menu.noRequirement')}</span>
                  )}
                </button>
              }
            />
            {/* Lifecycle lineage: 产品线 › 产品 › 版本 (derived from project→release) */}
            {release && (
              <div className="mt-1 rounded-[8px] bg-surface-2 px-2.5 py-2">
                <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-fg-3">
                  {t('detail.lifecycle')}
                </div>
                <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[12px] text-fg-2">
                  {productLine && (
                    <>
                      <Layers size={12} className="text-fg-3" />
                      <span>{productLine.name}</span>
                      <ChevronRight size={11} className="text-fg-3" />
                    </>
                  )}
                  {product && (
                    <>
                      <Box size={12} className="text-fg-3" />
                      <span>{product.name}</span>
                      <ChevronRight size={11} className="text-fg-3" />
                    </>
                  )}
                  <span className="font-mono font-semibold text-fg-1">{release.name}</span>
                </div>
              </div>
            )}
            {sprint && (
              <div className="flex items-center gap-2 px-2 py-1.5">
                <Target size={16} className="text-fg-3" />
                <span className="whitespace-nowrap text-[13px] text-fg-1">{sprint.name}</span>
              </div>
            )}

            <div className="my-4 h-px bg-border" />
            <LabelMenu
              current={issue.labels}
              onToggle={(labelId) =>
                patch({
                  labels: issue.labels.includes(labelId)
                    ? issue.labels.filter((x) => x !== labelId)
                    : [...issue.labels, labelId],
                })
              }
              trigger={
                <button className="block w-full rounded-[7px] p-1 text-left hover:bg-surface-2">
                  <div className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
                    {t('detail.labels')} <Plus size={12} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {labels.length ? (
                      labels.map((l) => <LabelChip key={l.id} label={l} />)
                    ) : (
                      <span className="text-[12.5px] text-fg-3">{t('detail.noLabels')}</span>
                    )}
                  </div>
                </button>
              }
            />
          </div>
        </div>
      </div>
    </>
  );
}
