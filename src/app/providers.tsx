'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppDataProvider } from '@/store/AppData';
import { LocaleProvider } from '@/lib/i18n';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 10_000 } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider locale="zh-CN">
        <AppDataProvider>{children}</AppDataProvider>
      </LocaleProvider>
    </QueryClientProvider>
  );
}
