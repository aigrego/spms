import * as React from 'react';
import IssuesClient from '../../issues/IssuesClient';
import { Skeleton } from '@/components/StateBlock';

/* /my-issues/<KEY> — 我的 Issues + 指定 issue 的详情抽屉。 */
export default async function MyIssueDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <IssuesClient view="mine" selected={key} />
    </React.Suspense>
  );
}
