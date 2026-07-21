import * as React from 'react';
import { AuthGate } from '@/components/AuthGate';
import { AppShell } from '@/components/AppShell';
import { Skeleton } from '@/components/StateBlock';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      {/* Suspense boundary covers useSearchParams() in the sidebar + pages. */}
      <React.Suspense
        fallback={
          <div className="flex h-screen bg-bg">
            <div className="w-[244px] flex-none border-r border-border bg-surface-2" />
            <div className="flex-1">
              <Skeleton rows={9} />
            </div>
          </div>
        }
      >
        <AppShell>{children}</AppShell>
      </React.Suspense>
    </AuthGate>
  );
}
