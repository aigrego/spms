'use client';

import * as React from 'react';
import { Plus, Users, Globe, Sparkles, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/glyphs/Avatar';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { InviteResourceModal } from '@/components/InviteResourceModal';
import { useT } from '@/lib/i18n';
import { useAppData } from '@/store/AppData';
import { useRevokeResource } from '@/store/resources';
import type { Member, MemberStatus } from '@/lib/types';

const STATUS_TONE: Record<MemberStatus, 'success' | 'orange' | 'neutral'> = {
  active: 'success',
  invited: 'orange',
  revoked: 'neutral',
};

function RevokeButton({ id }: { id: string }) {
  const t = useT();
  const revoke = useRevokeResource();
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="hover-surface rounded-md px-2 py-1 text-[12px] font-medium text-fg-3 hover:text-danger">
          {t('resources.revoke')}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[200px] p-2">
        <p className="px-1 pb-2 pt-1 text-[12px] leading-relaxed text-fg-2">{t('resources.externalNote')}</p>
        <Button
          variant="danger"
          size="sm"
          className="w-full"
          disabled={revoke.isPending}
          onClick={() => revoke.mutate(id, { onSuccess: () => setOpen(false) })}
        >
          {t('resources.revoke')}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function MemberRow({ m, you, children }: { m: Member; you?: boolean; children?: React.ReactNode }) {
  const t = useT();
  // Subtitle: external/synced humans show their email; agents show their role
  // descriptor. A human's free-form `role` ("lead") is not an agentRole key.
  const sub = m.email ?? (m.type === 'agent' && m.role ? t(`agentRole.${m.role}`) : '');
  return (
    <div className="flex items-center gap-3 bg-surface px-3 py-2">
      <Avatar person={m} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13.5px] font-medium text-fg-1">{m.name}</span>
          {you && <span className="text-[10.5px] text-fg-3">· {t('resources.you')}</span>}
        </div>
        {sub && (
          <div className="mt-0.5 flex items-center gap-1 truncate text-[11.5px] text-fg-3">
            {m.email && <Mail size={11} className="flex-none" />}
            <span className="truncate">{sub}</span>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function Section({
  icon,
  label,
  count,
  note,
  action,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-fg-3">{icon}</span>
        <h2 className="m-0 text-[14px] font-semibold text-fg-1">{label}</h2>
        <span className="rounded-full bg-surface-2 px-2 py-px text-[11.5px] font-semibold text-fg-3">{count}</span>
        <div className="flex-1" />
        {action}
      </div>
      {note && <p className="mb-2 text-[12px] leading-relaxed text-fg-3">{note}</p>}
      {children}
    </section>
  );
}

/* 研发资源池 — 内部成员 / 外部资源 / AI Agents 三段。The blueprint's
   同步通讯录 button is dropped: the portal directory-sync endpoint has no
   rewrite equivalent (see src/server/services/resources.ts). */
export function ResourcesView() {
  const t = useT();
  const { members, agents, meId } = useAppData();
  const [inviteOpen, setInviteOpen] = React.useState(false);

  const internal = members.filter((m) => m.type === 'human' && m.origin !== 'external');
  const external = members.filter((m) => m.type === 'human' && m.origin === 'external');
  const total = internal.length + external.length + agents.length;

  const listCls = 'flex flex-col divide-y divide-border overflow-hidden rounded-[12px] border border-border';

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        <h1 className="m-0 text-[18px] font-semibold tracking-tight text-fg-1">{t('resources.title')}</h1>
        <span className="rounded-full bg-surface-2 px-2.5 py-px text-[12.5px] font-semibold text-fg-3">{total}</span>
        <span className="hidden text-[12.5px] text-fg-3 md:inline">· {t('resources.subtitle')}</span>
        <div className="flex-1" />
        <Button variant="primary" size="md" onClick={() => setInviteOpen(true)}>
          <Plus size={14} /> {t('resources.invite')}
        </Button>
      </div>

      <div className="mx-auto flex w-full max-w-[920px] flex-1 flex-col gap-7 overflow-y-auto p-6">
        <Section icon={<Users size={15} />} label={t('resources.section.internal')} count={internal.length}>
          <div className={listCls}>
            {internal.map((m) => (
              <MemberRow key={m.id} m={m} you={m.id === meId} />
            ))}
          </div>
        </Section>

        <Section
          icon={<Globe size={15} />}
          label={t('resources.section.external')}
          count={external.length}
          note={t('resources.externalNote')}
          action={
            <Button variant="ghost" size="sm" onClick={() => setInviteOpen(true)}>
              <Plus size={13} /> {t('resources.invite')}
            </Button>
          }
        >
          {external.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-border px-4 py-7 text-center text-[12.5px] text-fg-3">
              {t('resources.emptyExternal')}
            </div>
          ) : (
            <div className={listCls}>
              {external.map((m) => (
                <MemberRow key={m.id} m={m}>
                  <Badge tone={STATUS_TONE[m.status ?? 'active']} dot>
                    {t(`status.${m.status ?? 'active'}`)}
                  </Badge>
                  {m.status !== 'revoked' && <RevokeButton id={m.id} />}
                </MemberRow>
              ))}
            </div>
          )}
        </Section>

        <Section icon={<Sparkles size={15} />} label={t('resources.section.agents')} count={agents.length}>
          <div className={listCls}>
            {agents.map((m) => (
              <MemberRow key={m.id} m={m} />
            ))}
          </div>
        </Section>
      </div>

      <InviteResourceModal open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}
