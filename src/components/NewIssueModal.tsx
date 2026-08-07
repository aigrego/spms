'use client';

import * as React from 'react';
import { FileText, Folder, Loader2, Paperclip, Tag, X } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { StatusIcon } from '@/components/glyphs/StatusIcon';
import { PriorityIcon } from '@/components/glyphs/PriorityIcon';
import { ImportanceIcon } from '@/components/glyphs/ImportanceIcon';
import { TypeIcon } from '@/components/glyphs/TypeIcon';
import { ProjectIcon } from '@/components/glyphs/misc';
import { Avatar } from '@/components/glyphs/Avatar';
import { TypeMenu, StatusMenu, PriorityMenu, ImportanceMenu, ProjectMenu, ScopedAssigneeMenu, LabelMenu } from '@/components/menus';
import { useT } from '@/lib/i18n';
import { api, type AttachmentMeta } from '@/lib/api';
import { uploadAttachment } from '@/lib/upload';
import { ATTACHMENT_ACCEPT, isImageType } from '@/lib/attachments';
import { usePersistentState } from '@/lib/prefs';
import { useAppData } from '@/store/AppData';
import { useCreateIssue } from '@/store/issues';
import { useNodeAssignments } from '@/store/resources';
import type { IssueStatus, IssuePriority, Importance, IssueType, Member } from '@/lib/types';

// forwardRef is REQUIRED: these chips are used as `PopoverTrigger asChild`
// triggers (the menu pickers). Radix's Slot needs to attach a ref to the trigger
// to anchor/open the popover — a plain function component swallows the ref, which
// silently breaks the menus (the form's options look "dead").
const Chip = React.forwardRef<
  HTMLButtonElement,
  { icon: React.ReactNode; label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(  ({ icon, label, ...rest }, ref) => (
    <button
      ref={ref}
      className="inline-flex h-[30px] items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-2.5 text-[13px] text-fg-1 hover:bg-surface-2"
      {...rest}
    >
      {icon} {label}
    </button>
  ),
);
Chip.displayName = 'Chip';

/* A file picked/pasted before the issue exists: uploaded to Blob at once,
   registered on the issue only after create succeeds. */
type PendingFile = {
  key: string;
  filename: string;
  contentType: string;
  // object URL for image thumbnails; empty for documents
  preview: string;
  meta: AttachmentMeta | null;
  uploading: boolean;
  failed: boolean;
};

export function NewIssueModal({
  open,
  onOpenChange,
  preset,
  presetProject,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  preset?: { status?: IssueStatus } | null;
  // when opened from a project context, preselect that project
  presetProject?: string | null;
  onCreated: (id: string) => void;
}) {
  const t = useT();
  const { memberById, projectById, agents } = useAppData();
  const create = useCreateIssue();
  const [title, setTitle] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [type, setType] = React.useState<IssueType>('ticket');
  const [status, setStatus] = React.useState<IssueStatus>('todo');
  const [priority, setPriority] = React.useState<IssuePriority>('none');
  const [importance, setImportance] = React.useState<Importance>('none');
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [assignee, setAssignee] = React.useState<string | null>(null);
  const [labels, setLabels] = React.useState<string[]>([]);
  const [pending, setPending] = React.useState<PendingFile[]>([]);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  // Browser memory: remember the last picked project so the next new issue
  // defaults to it (presetProject, when given, always wins).
  const [cachedProjectId, setCachedProjectId] = usePersistentState<string | null>(
    'newIssue.projectId',
    null,
    (v): v is string => typeof v === 'string',
  );

  React.useEffect(() => {
    if (open) {
      setTitle('');
      setDesc('');
      setType('ticket');
      setStatus(preset?.status ?? 'todo');
      setPriority('none');
      setImportance('none');
      setProjectId(presetProject ?? (cachedProjectId && projectById(cachedProjectId) ? cachedProjectId : null));
      setAssignee(null);
      setLabels([]);
      setPending([]);
      setSubmitError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preset, presetProject]);

  // Upload each picked/pasted file immediately; keep the blob meta pending
  // until the issue exists.
  const addFiles = (files: Iterable<File>) => {
    for (const file of files) {
      const key = crypto.randomUUID();
      const image = isImageType(file.type);
      setPending((p) => [
        ...p,
        {
          key,
          filename: file.name,
          contentType: file.type,
          preview: image ? URL.createObjectURL(file) : '',
          meta: null,
          uploading: true,
          failed: false,
        },
      ]);
      uploadAttachment(file)
        .then((meta) =>
          setPending((p) => p.map((x) => (x.key === key ? { ...x, meta, uploading: false } : x))),
        )
        .catch(() =>
          setPending((p) => p.map((x) => (x.key === key ? { ...x, uploading: false, failed: true } : x))),
        );
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const removePending = (key: string) => {
    // Dropping a pending item does not delete the already-uploaded blob
    // (orphan cleanup is out of scope).
    setPending((p) => p.filter((x) => x.key !== key));
  };

  // Assignee pool = the chosen project's research resources (humans) + AI agents.
  const { data: assignments = [] } = useNodeAssignments('project', projectId);
  const candidates = React.useMemo<Member[]>(() => {
    const humans = assignments
      .map((a) => a.member)
      .filter((m): m is Member => !!m && m.type === 'human');
    return [...humans, ...agents];
  }, [assignments, agents]);

  const project = projectById(projectId);
  const assigneeP = memberById(assignee);

  const submit = async () => {
    if (!title.trim() || !projectId) return;
    setSubmitError(null);
    try {
      const issue = await create.mutateAsync({
        title: title.trim(),
        description: desc.trim() || undefined,
        type,
        status,
        priority,
        importance,
        projectId,
        assigneeId: assignee,
        labels: labels.length ? labels : undefined,
      });
      // The issue exists now — register the pending uploads (issue.id is the
      // display key, e.g. "BUG-7"). A failed registration surfaces like a failed
      // create; the issue itself is already created either way.
      for (const p of pending) {
        if (p.meta) await api.registerAttachment(issue.id, p.meta);
      }
      onOpenChange(false);
      onCreated(issue.id);
    } catch (e) {
      // 不能把异常吞掉(弹框不关、无反馈、控制台 Uncaught)——issue 可能已创建,
      // 把错误展示出来让用户决定重试还是取消。
      setSubmitError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} onPaste={onPaste}>
        <DialogPrimitive.Title className="sr-only">{t('newIssue.title')}</DialogPrimitive.Title>
        <div className="flex items-center gap-2 px-[18px] pt-3.5">
          <span className="text-[12.5px] font-medium text-fg-2">{t('newIssue.title')}</span>
        </div>
        <div className="px-[18px] pb-1 pt-3">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
            placeholder={t('newIssue.titlePlaceholder')}
            className="w-full border-0 bg-transparent text-[19px] font-semibold text-fg-1 outline-none placeholder:text-fg-3"
          />
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={3}
            placeholder={t('newIssue.descPlaceholder')}
            className="mt-2 w-full resize-none border-0 bg-transparent text-sm leading-relaxed text-fg-1 outline-none placeholder:text-fg-3"
          />
          {pending.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {pending.map((p) => (
                <div
                  key={p.key}
                  title={p.failed ? t('issue.uploadFailed') : p.filename}
                  className="relative h-14 w-14 overflow-hidden rounded-lg border border-border"
                >
                  {p.preview ? (
                    <img src={p.preview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-surface-2 px-1">
                      <FileText size={16} className="flex-none text-fg-3" />
                      <span className="w-full truncate text-center text-[10px] leading-tight text-fg-2">
                        {p.filename}
                      </span>
                    </div>
                  )}
                  {p.uploading && (
                    <div className="absolute inset-0 grid place-items-center bg-black/40">
                      <Loader2 size={16} className="animate-spin text-white" />
                    </div>
                  )}
                  {p.failed && <div className="absolute inset-0 bg-danger/30" />}
                  <button
                    onClick={() => removePending(p.key)}
                    aria-label="remove"
                    className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-black/55 text-white hover:bg-black/75"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 px-[18px] pb-4 pt-1.5">
          <ProjectMenu
            current={projectId}
            onPick={(id) => {
              setProjectId(id);
              setCachedProjectId(id);
              setAssignee(null);
            }}
            trigger={
              <Chip
                icon={
                  project ? (
                    <span className="grid h-[18px] w-[18px] place-items-center rounded" style={{ background: project.color }}>
                      <ProjectIcon name={project.icon} size={12} />
                    </span>
                  ) : (
                    <Folder size={15} className="text-fg-3" />
                  )
                }
                label={project ? project.name : t('newIssue.pickProject')}
              />
            }
          />
          <TypeMenu
            current={type}
            onPick={setType}
            trigger={<Chip icon={<TypeIcon type={type} size={15} />} label={t(`type.${type}`)} />}
          />
          <StatusMenu
            current={status}
            onPick={setStatus}
            trigger={<Chip icon={<StatusIcon status={status} size={15} />} label={t(`status.${status}`)} />}
          />
          <PriorityMenu
            current={priority}
            onPick={setPriority}
            trigger={
              <Chip icon={<PriorityIcon priority={priority} size={15} />} label={t(`priority.${priority}`)} />
            }
          />
          <ImportanceMenu
            current={importance}
            onPick={setImportance}
            trigger={
              <Chip icon={<ImportanceIcon importance={importance} size={15} />} label={t(`importance.${importance}`)} />
            }
          />
          {projectId ? (
            <ScopedAssigneeMenu
              candidates={candidates}
              current={assignee}
              onPick={setAssignee}
              emptyHint={t('newIssue.noResources')}
              trigger={
                <Chip
                  icon={<Avatar person={assigneeP} size={18} />}
                  label={assigneeP ? assigneeP.name : t('menu.assignee')}
                />
              }
            />
          ) : (
            <span className="inline-flex h-[30px] items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 text-[13px] text-fg-3">
              <Avatar person={null} size={18} /> {t('newIssue.pickProjectFirst')}
            </span>
          )}
          <LabelMenu
            current={labels}
            onToggle={(id) => setLabels((ls) => (ls.includes(id) ? ls.filter((x) => x !== id) : [...ls, id]))}
            trigger={
              <Chip
                icon={<Tag size={14} className="text-fg-3" />}
                label={labels.length ? `${t('detail.labels')} · ${labels.length}` : t('detail.labels')}
              />
            }
          />
          <Chip
            icon={<Paperclip size={14} className="text-fg-3" />}
            label={t('issue.attachImage')}
            onClick={() => fileInputRef.current?.click()}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
          {submitError && <span className="min-w-0 flex-1 truncate text-[12.5px] text-danger">{submitError}</span>}
          <div className="flex-1" />
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={submit}
            disabled={!title.trim() || !projectId || create.isPending || pending.some((p) => p.uploading)}
          >
            {t('newIssue.create')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
