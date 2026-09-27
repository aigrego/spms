import * as React from 'react';
import { AuthGate } from '@/components/AuthGate';
import { AppShell } from '@/components/AppShell';
import { ShellSkeleton } from '@/components/StateBlock';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      {/* Suspense boundary covers useSearchParams() in the sidebar + pages. */}
      <React.Suspense fallback={<ShellSkeleton />}>
        <AppShell>{children}</AppShell>
      </React.Suspense>
    </AuthGate>
  );
}
