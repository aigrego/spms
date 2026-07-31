import * as React from 'react';
import { redirect } from 'next/navigation';
import SettingsClient from './SettingsClient';
import { Skeleton } from '@/components/StateBlock';

/* /settings — 偏好。旧查询参数 ?tab=<tab> 301 到 /settings/<tab>。 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  if (typeof sp.tab === 'string' && sp.tab) redirect(`/settings/${sp.tab}`);
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <SettingsClient />
    </React.Suspense>
  );
}
