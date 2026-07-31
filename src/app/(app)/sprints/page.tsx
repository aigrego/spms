import * as React from 'react';
import { redirect } from 'next/navigation';
import SprintsClient from './SprintsClient';
import { Skeleton } from '@/components/StateBlock';

/* /sprints — 默认落到活跃迭代。旧查询参数深链 301 到 RESTful 路径:
   ?selected=<id> → /sprints/<id>;?selected=<id>&issue=<KEY> → /sprints/<id>/issues/<KEY>。 */
export default async function SprintsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  if (typeof sp.selected === 'string' && sp.selected) {
    const issue = typeof sp.issue === 'string' && sp.issue ? `/issues/${encodeURIComponent(sp.issue)}` : '';
    redirect(`/sprints/${sp.selected}${issue}`);
  }
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <SprintsClient />
    </React.Suspense>
  );
}
