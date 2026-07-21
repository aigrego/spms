'use client';

import * as React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { ProjectIcon } from '@/components/glyphs/misc';
import { useT } from '@/lib/i18n';
import { useAppData } from '@/store/AppData';
import { useCreateProject, useUpdateProject } from '@/store/projects';
import type { Project, ProjectStatus } from '@/lib/types';

const SWATCHES = ['#0063D3', '#1F9D55', '#7A5AE0', '#D89400', '#D6293E', '#0EA5A5', '#DB5A00'];
const ICONS = ['box', 'zap', 'eye', 'target', 'activity'];
const STATUSES: ProjectStatus[] = ['backlog', 'planned', 'in_progress', 'completed'];

const fieldLabel = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-3';
const inputCls =
  'h-9 w-full rounded-lg border border-border-strong bg-surface px-2.5 text-[13px] text-fg-1 outline-none focus:border-brand-blue';

export function ProjectModal({
  open,
  onOpenChange,
  project,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  project?: Project | null;
  onSaved?: (id: string) => void;
}) {
  const t = useT();
  const { teams, releases, humans, agents, productById, firstTeamId } = useAppData();
  const create = useCreateProject();
  const update = useUpdateProject();
  const editing = !!project;

  const [name, setName] = React.useState('');
  const [teamId, setTeamId] = React.useState('');
  const [releaseId, setReleaseId] = React.useState('');
  const [status, setStatus] = React.useState<ProjectStatus>('backlog');
  const [leadId, setLeadId] = React.useState('');
  const [aiLeadId, setAiLeadId] = React.useState('');
  const [icon, setIcon] = React.useState('box');
  const [color, setColor] = React.useState('#0063D3');
  const [target, setTarget] = React.useState('');
  const [description, setDescription] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setName(project?.name ?? '');
    setTeamId(project?.teamId ?? firstTeamId ?? '');
    setReleaseId(project?.releaseId ?? '');
    setStatus(project?.status ?? 'backlog');
    setLeadId(project?.leadId ?? '');
    setAiLeadId(project?.aiLeadId ?? '');
    setIcon(project?.icon ?? 'box');
    setColor(project?.color ?? '#0063D3');
    setTarget(project?.target ?? '');
    setDescription(project?.description ?? '');
  }, [open, project, firstTeamId]);

  const releaseOptions = releases.map((r) => ({ id: r.id, label: `${productById(r.productId)?.name ?? ''} · ${r.name}` }));

  const submit = async () => {
    if (!name.trim()) return;
    const input = {
      name: name.trim(),
      teamId: teamId || null,
      releaseId: releaseId || null,
      status,
      leadId: leadId || null,
      aiLeadId: aiLeadId || null,
      icon,
      color,
      target: target.trim() || null,
      description: description.trim() || null,
    };
    const row = editing
      ? await update.mutateAsync({ id: project!.id, input })
      : await create.mutateAsync(input);
    onOpenChange(false);
    onSaved?.(row.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogPrimitive.Title className="px-[18px] pb-1 pt-4 text-[15px] font-semibold text-fg-1">
          {editing ? t('projects.edit') : t('projects.new')}
        </DialogPrimitive.Title>
        <div className="flex flex-col gap-3 px-[18px] py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px]" style={{ background: color }}>
              <ProjectIcon name={icon} size={18} />
            </span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('newProject.namePlaceholder')}
              className="w-full border-0 bg-transparent text-[17px] font-semibold text-fg-1 outline-none placeholder:text-fg-3"
            />
          </div>

          <div className="flex gap-2">
            <div className="flex gap-1.5">
              {ICONS.map((ic) => (
                <button
                  key={ic}
                  onClick={() => setIcon(ic)}
                  className="grid h-8 w-8 place-items-center rounded-lg border"
                  style={{ borderColor: icon === ic ? color : 'var(--border)', background: icon === ic ? color : 'var(--surface-2)' }}
                >
                  <ProjectIcon name={ic} size={15} color={icon === ic ? '#fff' : 'var(--fg-3)'} />
                </button>
              ))}
            </div>
            <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  aria-label={c}
                  className="h-6 w-6 rounded-md transition-transform hover:scale-110"
                  style={{ background: c, outline: color === c ? '2px solid var(--fg-1)' : 'none', outlineOffset: 1 }}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <span className={fieldLabel}>{t('project.team')}</span>
              <select className={inputCls} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">—</option>
                {teams.map((tm) => (
                  <option key={tm.id} value={tm.id}>
                    {tm.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <span className={fieldLabel}>{t('projects.release')}</span>
              <select className={inputCls} value={releaseId} onChange={(e) => setReleaseId(e.target.value)}>
                <option value="">—</option>
                {releaseOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <span className={fieldLabel}>{t('project.status')}</span>
              <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`projectStatus.${s}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <span className={fieldLabel}>{t('products.lead')}</span>
              <select className={inputCls} value={leadId} onChange={(e) => setLeadId(e.target.value)}>
                <option value="">—</option>
                {humans.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <span className={fieldLabel}>{t('requirements.aiOwner')}</span>
              <select className={inputCls} value={aiLeadId} onChange={(e) => setAiLeadId(e.target.value)}>
                <option value="">—</option>
                {agents.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-[110px]">
              <span className={fieldLabel}>{t('project.target')}</span>
              <input className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Q3" />
            </div>
          </div>

          <div>
            <span className={fieldLabel}>{t('form.desc')}</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-lg border border-border-strong bg-surface px-2.5 py-2 text-[13px] leading-relaxed text-fg-1 outline-none focus:border-brand-blue"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
          <div className="flex-1" />
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!name.trim() || create.isPending || update.isPending}>
            {editing ? t('common.save') : t('projects.new')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
