import * as React from 'react';
import { redirect } from 'next/navigation';
import BacklogClient from './BacklogClient';
import { Skeleton } from '@/components/StateBlock';

/* /backlog — 产品待办。旧深链 ?selected=<KEY> 301 到 /backlog/<KEY>。 */
export default async function BacklogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  if (typeof sp.selected === 'string' && sp.selected) {
    redirect(`/backlog/${encodeURIComponent(sp.selected)}`);
  }
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <BacklogClient />
    </React.Suspense>
  );
}
