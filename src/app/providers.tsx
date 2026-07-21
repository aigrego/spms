'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppDataProvider } from '@/store/AppData';
import { LocaleProvider } from '@/lib/i18n';
import { readThemePref, applyTheme } from '@/lib/theme';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 10_000 } },
      }),
  );
  // Bind the OS-level dark-mode listener when the persisted pref is 'system'
  // (the anti-flash script only resolves the initial paint).
  React.useEffect(() => {
    if (readThemePref() === 'system') applyTheme('system');
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider locale="zh-CN">
        <AppDataProvider>{children}</AppDataProvider>
      </LocaleProvider>
    </QueryClientProvider>
  );
}
