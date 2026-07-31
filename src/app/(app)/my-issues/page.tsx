import * as React from 'react';
import IssuesClient from '../issues/IssuesClient';
import { Skeleton } from '@/components/StateBlock';

/* /my-issues — 我的 Issues(原 /issues?assignee=me)。 */
export default function MyIssuesPage() {
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <IssuesClient view="mine" />
    </React.Suspense>
  );
}
