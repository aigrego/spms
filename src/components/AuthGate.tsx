'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/api';
import { Skeleton } from '@/components/StateBlock';

/* Client-side auth fallback: middleware already redirects when the session
   cookie is absent; this catches an invalid/expired cookie (session check
   returns null) and bounces to /login. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [authed, setAuthed] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    authApi
      .getSession()
      .then((user) => {
        if (!alive) return;
        if (user) setAuthed(true);
        else router.replace('/login');
      })
      .catch(() => {
        if (alive) router.replace('/login');
      });
    return () => {
      alive = false;
    };
  }, [router]);

  if (!authed) {
    return (
      <div className="flex h-screen bg-bg">
        <div className="w-[244px] flex-none border-r border-border bg-surface-2" />
        <div className="flex-1">
          <Skeleton rows={9} />
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
