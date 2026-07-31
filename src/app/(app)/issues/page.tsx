import * as React from 'react';
import { redirect } from 'next/navigation';
import IssuesClient from './IssuesClient';
import { Skeleton } from '@/components/StateBlock';

/* /issues — 全部 Issues。旧查询参数深链 301 到 RESTful 路径:
   ?assignee=me → /my-issues;?selected=<KEY> → /issues/<KEY>。 */
export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  if (sp.assignee === 'me') redirect('/my-issues');
  if (typeof sp.selected === 'string' && sp.selected) {
    redirect(`/issues/${encodeURIComponent(sp.selected)}`);
  }
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <IssuesClient view="all" />
    </React.Suspense>
  );
}
