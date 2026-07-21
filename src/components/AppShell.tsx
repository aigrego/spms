'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { CommandPalette } from '@/components/CommandPalette';
import { NewIssueModal } from '@/components/NewIssueModal';
import { Skeleton } from '@/components/StateBlock';
import { useAppData } from '@/store/AppData';
import { useAllIssues } from '@/store/issues';
import type { IssueStatus } from '@/lib/types';

interface ShellValue {
  openNewIssue: (preset?: { status?: IssueStatus }) => void;
}

const ShellContext = React.createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const ctx = React.useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used within AppShell');
  return ctx;
}

/* The (app) chrome: sidebar + routed main area + global overlays
   (⌘K command palette, "c" new-issue modal). */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { loading, meId } = useAppData();
  const { data: allIssues = [] } = useAllIssues();
  const [cmdOpen, setCmdOpen] = React.useState(false);
  const [newOpen, setNewOpen] = React.useState(false);
  const [newPreset, setNewPreset] = React.useState<{ status?: IssueStatus } | null>(null);

  const openNewIssue = React.useCallback((preset?: { status?: IssueStatus }) => {
    setNewPreset(preset ?? null);
    setNewOpen(true);
  }, []);

  const openIssue = React.useCallback(
    (key: string) => router.push(`/issues?selected=${encodeURIComponent(key)}`),
    [router],
  );

  // Global shortcuts: ⌘K command palette, "c" new issue. Suppressed while the
  // focus is in a text input / contentEditable.
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((o) => !o);
      } else if (!typing && e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        openNewIssue();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [openNewIssue]);

  const myCount = allIssues.filter(
    (i) => i.assigneeId === meId && !['done', 'canceled'].includes(i.status),
  ).length;

  if (loading) {
    return (
      <div className="flex h-screen bg-bg">
        <div className="w-[244px] flex-none border-r border-border bg-surface-2" />
        <div className="flex-1">
          <Skeleton rows={9} />
        </div>
      </div>
    );
  }

  return (
    <ShellContext.Provider value={{ openNewIssue }}>
      <div className="flex h-screen overflow-hidden bg-bg">
        <Sidebar onOpenCmd={() => setCmdOpen(true)} myCount={myCount} />
        <main className="flex h-screen min-w-0 flex-1 flex-col">{children}</main>

        <CommandPalette
          open={cmdOpen}
          onOpenChange={setCmdOpen}
          onNavigate={(href) => router.push(href)}
          onOpenIssue={openIssue}
          onNewIssue={() => openNewIssue()}
        />
        <NewIssueModal
          open={newOpen}
          onOpenChange={setNewOpen}
          preset={newPreset}
          presetProject={null}
          onCreated={openIssue}
        />
      </div>
    </ShellContext.Provider>
  );
}
