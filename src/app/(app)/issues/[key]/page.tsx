import * as React from 'react';
import IssuesClient from '../IssuesClient';
import { Skeleton } from '@/components/StateBlock';

/* /issues/<KEY> — 列表 + 指定 issue 的详情抽屉(原 /issues?selected=<KEY>)。 */
export default async function IssueDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <IssuesClient view="all" selected={key} />
    </React.Suspense>
  );
}
