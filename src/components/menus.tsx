'use client';

import * as React from 'react';
import { Sparkles, FileText } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent, MenuItem } from '@/components/ui/popover';
import { StatusIcon } from '@/components/glyphs/StatusIcon';
import { PriorityIcon } from '@/components/glyphs/PriorityIcon';
import { ImportanceIcon } from '@/components/glyphs/ImportanceIcon';
import { TypeIcon } from '@/components/glyphs/TypeIcon';
import { Avatar } from '@/components/glyphs/Avatar';
import { ProjectIcon } from '@/components/glyphs/misc';
import { STATUS_ORDER, PRIORITY_ORDER, IMPORTANCE_ORDER, ISSUE_TYPE_ORDER } from '@/lib/constants';
import { useAppData } from '@/store/AppData';
import { useRequirements } from '@/store/requirements';
import { useCreateLabel } from '@/store/issues';
import { useT } from '@/lib/i18n';
import type { IssueStatus, IssuePriority, Importance, IssueType, Member } from '@/lib/types';

const SectionLabel = ({ children, accent }: { children: React.ReactNode; accent?: boolean }) => (
  <div
    className="flex items-center gap-1 px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider"
    style={{ color: accent ? 'var(--brand-orange)' : 'var(--fg-3)' }}
  >
    {children}
  </div>
);

/* Generic inline-edit popover: renders a trigger, opens a menu. */
function InlinePopover({
  trigger,
  children,
  width = 220,
}: {
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  width?: number;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
        // Don't grab focus on open: when this menu is rendered inside a modal
        // Dialog (e.g. the New Issue form), the Dialog's focus trap yanks focus
        // straight back, which would otherwise slam the menu shut the instant it
        // opens (making the form's options look "dead"). Click-driven menu, so
        // skipping auto-focus costs nothing.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

export function StatusMenu({
  current,
  onPick,
  trigger,
}: {
  current: IssueStatus;
  onPick: (s: IssueStatus) => void;
  trigger: React.ReactNode;
}) {
  const t = useT();
  return (
    <InlinePopover trigger={trigger} width={200}>
      {(close) => (
        <>
          <SectionLabel>{t('menu.status')}</SectionLabel>
          {STATUS_ORDER.map((s) => (
            <MenuItem
              key={s}
              glyph={<StatusIcon status={s} size={16} />}
              label={t(`status.${s}`)}
              selected={current === s}
              onClick={() => {
                onPick(s);
                close();
              }}
            />
          ))}
        </>
      )}
    </InlinePopover>
  );
}

export function TypeMenu({
  current,
  onPick,
  trigger,
}: {
  current: IssueType;
  onPick: (s: IssueType) => void;
  trigger: React.ReactNode;
}) {
  const t = useT();
  return (
    <InlinePopover trigger={trigger} width={180}>
      {(close) => (
        <>
          <SectionLabel>{t('menu.type')}</SectionLabel>
          {ISSUE_TYPE_ORDER.map((ty) => (
            <MenuItem
              key={ty}
              glyph={<TypeIcon type={ty} size={16} />}
              label={t(`type.${ty}`)}
              selected={current === ty}
              onClick={() => {
                onPick(ty);
                close();
              }}
            />
          ))}
        </>
      )}
    </InlinePopover>
  );
}

export function PriorityMenu({
  current,
  onPick,
  trigger,
}: {
  current: IssuePriority;
  onPick: (p: IssuePriority) => void;
  trigger: React.ReactNode;
}) {
  const t = useT();
  return (
    <InlinePopover trigger={trigger} width={180}>
      {(close) => (
        <>
          <SectionLabel>{t('menu.priority')}</SectionLabel>
          {PRIORITY_ORDER.map((p) => (
            <MenuItem
              key={p}
              glyph={<PriorityIcon priority={p} size={16} />}
              label={t(`priority.${p}`)}
              selected={current === p}
              onClick={() => {
                onPick(p);
                close();
              }}
            />
          ))}
        </>
      )}
    </InlinePopover>
  );
}

export function ImportanceMenu({
  current,
  onPick,
  trigger,
}: {
  current: Importance;
  onPick: (p: Importance) => void;
  trigger: React.ReactNode;
}) {
  const t = useT();
  return (
    <InlinePopover trigger={trigger} width={180}>
      {(close) => (
        <>
          <SectionLabel>{t('menu.importance')}</SectionLabel>
          {IMPORTANCE_ORDER.map((p) => (
            <MenuItem
              key={p}
              glyph={<ImportanceIcon importance={p} size={16} />}
              label={t(`importance.${p}`)}
              selected={current === p}
              onClick={() => {
                onPick(p);
                close();
              }}
            />
          ))}
        </>
      )}
    </InlinePopover>
  );
}

/* Link an issue to a requirement (PRD). Scoped to the issue's project — only that
   project's requirements are linkable; '' clears the link. */
export function RequirementMenu({
  projectId,
  current,
  onPick,
  trigger,
}: {
  projectId: string | null;
  current: string | null;
  onPick: (id: string | null) => void;
  trigger: React.ReactNode;
}) {
  const t = useT();
  const { data: requirements = [] } = useRequirements(projectId ? { project: projectId } : undefined);
  return (
    <InlinePopover trigger={trigger} width={280}>
      {(close) => (
        <>
          <SectionLabel>{t('menu.requirement')}</SectionLabel>
          <MenuItem
            glyph={<FileText size={15} className="text-fg-3" />}
            label={t('menu.noRequirement')}
            selected={!current}
            onClick={() => {
              onPick(null);
              close();
            }}
          />
          {requirements.map((r) => (
            <MenuItem
              key={r.id}
              glyph={<ImportanceIcon importance={r.importance} size={14} />}
              label={r.title}
              meta={r.id}
              selected={current === r.id}
              onClick={() => {
                onPick(r.id);
                close();
              }}
            />
          ))}
        </>
      )}
    </InlinePopover>
  );
}

/* Pick the project an issue belongs to (lists all projects in the tenant). */
export function ProjectMenu({
  current,
  onPick,
  trigger,
}: {
  current: string | null;
  onPick: (id: string) => void;
  trigger: React.ReactNode;
}) {
  const t = useT();
  const { projects } = useAppData();
  return (
    <InlinePopover trigger={trigger} width={260}>
      {(close) => (
        <>
          <SectionLabel>{t('menu.project')}</SectionLabel>
          {projects.length === 0 && (
            <div className="px-2.5 py-2 text-[12.5px] text-fg-3">{t('menu.noProjects')}</div>
          )}
          {projects.map((p) => (
            <MenuItem
              key={p.id}
              glyph={
                <span className="grid h-4 w-4 flex-none place-items-center rounded" style={{ background: p.color }}>
                  <ProjectIcon name={p.icon} size={11} />
                </span>
              }
              label={p.name}
              selected={current === p.id}
              onClick={() => {
                onPick(p.id);
                close();
              }}
            />
          ))}
        </>
      )}
    </InlinePopover>
  );
}

/* Assignee picker scoped to an explicit candidate pool (a project's research
   resources + AI agents), rather than the whole tenant. */
export function ScopedAssigneeMenu({
  candidates,
  current,
  onPick,
  trigger,
  emptyHint,
}: {
  candidates: Member[];
  current: string | null;
  onPick: (id: string | null) => void;
  trigger: React.ReactNode;
  emptyHint?: string;
}) {
  const t = useT();
  const humans = candidates.filter((m) => m.type === 'human');
  const agents = candidates.filter((m) => m.type === 'agent');
  return (
    <InlinePopover trigger={trigger} width={248}>
      {(close) => (
        <>
          <SectionLabel>{t('menu.assignee')}</SectionLabel>
          <MenuItem
            glyph={<Avatar person={null} size={20} />}
            label={t('common.unassigned')}
            selected={!current}
            onClick={() => {
              onPick(null);
              close();
            }}
          />
          {humans.length === 0 && emptyHint && (
            <div className="px-2.5 py-1.5 text-[12px] leading-snug text-fg-3">{emptyHint}</div>
          )}
          {humans.map((u) => (
            <MenuItem
              key={u.id}
              glyph={<Avatar person={u} size={20} />}
              label={u.name}
              meta={u.companyRole ? t(`role.${u.companyRole}`) : undefined}
              selected={current === u.id}
              onClick={() => {
                onPick(u.id);
                close();
              }}
            />
          ))}
          {agents.length > 0 && (
            <>
              <SectionLabel accent>
                <Sparkles size={12} /> AI Agents
              </SectionLabel>
              {agents.map((a) => (
                <MenuItem
                  key={a.id}
                  glyph={<Avatar person={a} size={20} />}
                  label={a.name}
                  meta={a.agentKey ? t(`agentRole.${a.role}`).split(' / ')[0] : undefined}
                  selected={current === a.id}
                  onClick={() => {
                    onPick(a.id);
                    close();
                  }}
                />
              ))}
            </>
          )}
        </>
      )}
    </InlinePopover>
  );
}

/* 现场创建标签的备选色板（BUG-17）。 */
const LABEL_COLORS = ['#0063D3', '#FF6B02', '#1F9D55', '#E5484D', '#8E4EC6', '#E93D82', '#12A594', '#697177'];

/* Multi-select label editor — toggles a tenant label on/off the issue. Stays open
   while you toggle (does NOT call close), unlike the single-select menus.
   BUG-17: 底部内联创建自定义标签，创建成功即选中到当前 issue。 */
export function LabelMenu({
  current,
  onToggle,
  trigger,
}: {
  current: string[];
  onToggle: (id: string) => void;
  trigger: React.ReactNode;
}) {
  const t = useT();
  const { labels } = useAppData();
  const createLabel = useCreateLabel();
  const [draft, setDraft] = React.useState('');
  const [color, setColor] = React.useState(LABEL_COLORS[0]);
  const submit = () => {
    const name = draft.trim();
    if (!name || createLabel.isPending) return;
    createLabel.mutate(
      { name, color },
      { onSuccess: (l) => {
        setDraft('');
        onToggle(l.id);
      } },
    );
  };
  return (
    <InlinePopover trigger={trigger} width={220}>
      {() => (
        <>
          <SectionLabel>{t('detail.labels')}</SectionLabel>
          {labels.length === 0 && (
            <div className="px-2.5 py-2 text-[12.5px] text-fg-3">{t('detail.noLabels')}</div>
          )}
          {labels.map((l) => (
            <MenuItem
              key={l.id}
              glyph={<span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: l.color }} />}
              label={l.name}
              selected={current.includes(l.id)}
              onClick={() => onToggle(l.id)}
            />
          ))}
          <div className="mt-1 border-t border-border px-2.5 py-2">
            <div className="mb-1.5 flex items-center gap-1.5">
              {LABEL_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className="h-4 w-4 rounded-full transition-transform"
                  style={{ background: c, boxShadow: c === color ? `0 0 0 2px var(--surface), 0 0 0 4px ${c}` : 'none' }}
                />
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                }}
                placeholder={t('labels.namePh')}
                className="h-7 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-2 text-[12.5px] text-fg-1 outline-none placeholder:text-fg-3 focus:border-brand-blue"
              />
              <button
                type="button"
                onClick={submit}
                disabled={!draft.trim() || createLabel.isPending}
                className="h-7 flex-none rounded-md bg-brand-blue px-2 text-[12px] font-medium text-white disabled:opacity-40"
              >
                {t('labels.create')}
              </button>
            </div>
            {createLabel.isError && <div className="mt-1 text-[11.5px] text-danger">{t('common.createFailed')}</div>}
          </div>
        </>
      )}
    </InlinePopover>
  );
}

export function AssigneeMenu({
  current,
  onPick,
  trigger,
}: {
  current: string | null;
  onPick: (id: string | null) => void;
  trigger: React.ReactNode;
}) {
  const { humans, agents } = useAppData();
  const t = useT();
  return (
    <InlinePopover trigger={trigger} width={240}>
      {(close) => (
        <>
          <SectionLabel>{t('menu.assignee')}</SectionLabel>
          <MenuItem
            glyph={<Avatar person={null} size={20} />}
            label={t('common.unassigned')}
            selected={!current}
            onClick={() => {
              onPick(null);
              close();
            }}
          />
          {humans.map((u) => (
            <MenuItem
              key={u.id}
              glyph={<Avatar person={u} size={20} />}
              label={u.name}
              meta={u.companyRole ? t(`role.${u.companyRole}`) : undefined}
              selected={current === u.id}
              onClick={() => {
                onPick(u.id);
                close();
              }}
            />
          ))}
          <SectionLabel accent>
            <Sparkles size={12} /> AI Agents
          </SectionLabel>
          {agents.map((a) => (
            <MenuItem
              key={a.id}
              glyph={<Avatar person={a} size={20} />}
              label={a.name}
              meta={a.agentKey ? t(`agentRole.${a.role}`).split(' / ')[0] : undefined}
              selected={current === a.id}
              onClick={() => {
                onPick(a.id);
                close();
              }}
            />
          ))}
        </>
      )}
    </InlinePopover>
  );
}
