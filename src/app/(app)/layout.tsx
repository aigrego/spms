import * as React from 'react';
import { AuthGate } from '@/components/AuthGate';
import { AppShell } from '@/components/AppShell';
import { Skeleton } from '@/components/StateBlock';

// Keep in sync with HEADER_HEIGHT in components/Header.tsx (this layout is a
// server component and cannot import a value from the client module).
const HEADER_HEIGHT = 52;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      {/* Suspense boundary covers useSearchParams() in the sidebar + pages. */}
      <React.Suspense
        fallback={
          <div className="flex h-screen flex-col bg-bg">
            <div
              className="flex-none border-b border-border bg-surface"
              style={{ height: HEADER_HEIGHT }}
            />
            <div className="flex min-h-0 flex-1">
              <div className="w-[244px] flex-none border-r border-border bg-surface-2" />
              <div className="flex-1">
                <Skeleton rows={9} />
              </div>
            </div>
          </div>
        }
      >
        <AppShell>{children}</AppShell>
      </React.Suspense>
    </AuthGate>
  );
}
