'use client';

import * as React from 'react';
import { Command } from 'cmdk';
import { Plus, LayoutGrid, Box, Map, Search, Layers, FileText } from 'lucide-react';
import { Dialog, DialogContent, DialogPortal, DialogOverlay } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { StatusIcon } from '@/components/glyphs/StatusIcon';
import { AISlaBadge } from '@/components/glyphs/misc';
import { useT } from '@/lib/i18n';
import { useAllIssues } from '@/store/issues';

export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
  onOpenIssue,
  onNewIssue,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  // href-based navigation (App Router paths)
  onNavigate: (href: string) => void;
  onOpenIssue: (id: string) => void;
  onNewIssue: () => void;
}) {
  const t = useT();
  const { data: issues = [] } = useAllIssues();
  const [q, setQ] = React.useState('');

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  const navItems = [
    { icon: Plus, label: t('cmd.new'), kbd: 'C', act: () => onNewIssue() },
    { icon: LayoutGrid, label: t('cmd.openMyIssues'), act: () => onNavigate('/issues?assignee=me') },
    { icon: Layers, label: t('cmd.openProducts'), act: () => onNavigate('/products') },
    { icon: FileText, label: t('cmd.openRequirements'), act: () => onNavigate('/requirements') },
    { icon: Box, label: t('cmd.openProjects'), act: () => onNavigate('/projects') },
    { icon: Map, label: t('cmd.openRoadmap'), act: () => onNavigate('/roadmap') },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[12vh] z-[2001] w-[min(620px,92vw)] -translate-x-1/2 overflow-hidden rounded-[14px] border border-border bg-surface shadow-4 outline-none data-[state=open]:animate-popIn"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">{t('cmd.title')}</DialogPrimitive.Title>
          <Command shouldFilter={false} loop>
            <div className="flex items-center gap-2.5 border-b border-border px-[18px] py-3.5">
              <Search size={18} className="text-fg-3" />
              <Command.Input
                value={q}
                onValueChange={setQ}
                autoFocus
                placeholder={t('cmd.placeholder')}
                className="flex-1 border-0 bg-transparent text-[15px] text-fg-1 outline-none placeholder:text-fg-3"
              />
              <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-3">
                Esc
              </kbd>
            </div>
            <Command.List className="max-h-[400px] overflow-y-auto p-1.5">
              <Command.Empty className="px-2.5 py-6 text-center text-[13px] text-fg-3">
                {t('cmd.empty')}
              </Command.Empty>
              <Command.Group
                heading={t('cmd.commands')}
                className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-fg-3"
              >
                {navItems
                  .filter((n) => !q || n.label.toLowerCase().includes(q.toLowerCase()))
                  .map((n) => (
                    <Command.Item
                      key={n.label}
                      value={n.label}
                      onSelect={() => run(n.act)}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-[13.5px] text-fg-1 data-[selected=true]:bg-[var(--brand-blue-tint-8)]"
                    >
                      <n.icon size={16} className="text-fg-2" />
                      <span className="flex-1">{n.label}</span>
                      {n.kbd && (
                        <kbd className="rounded border border-border bg-surface-2 px-1.5 py-px font-mono text-[11px] text-fg-3">
                          {n.kbd}
                        </kbd>
                      )}
                    </Command.Item>
                  ))}
              </Command.Group>
              {q && (
                <Command.Group>
                  {issues
                    .filter(
                      (i) =>
                        i.title.toLowerCase().includes(q.toLowerCase()) ||
                        i.id.toLowerCase().includes(q.toLowerCase()),
                    )
                    .slice(0, 6)
                    .map((i) => (
                      <Command.Item
                        key={i.id}
                        value={`${i.id} ${i.title}`}
                        onSelect={() => run(() => onOpenIssue(i.id))}
                        className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2.5 data-[selected=true]:bg-[var(--brand-blue-tint-8)]"
                      >
                        <StatusIcon status={i.status} size={15} />
                        <span className="flex-none font-mono text-[11.5px] text-fg-3">{i.id}</span>
                        <span className="flex-1 truncate text-[13.5px] text-fg-1">{i.title}</span>
                        {i.aiAssigned && <AISlaBadge />}
                      </Command.Item>
                    ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
