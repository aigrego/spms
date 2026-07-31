import * as React from 'react';
import SprintsClient from '../../../SprintsClient';
import { Skeleton } from '@/components/StateBlock';

/* /sprints/<sprintId>/issues/<KEY> — 看板 + 指定 issue 的详情抽屉
   (原 /sprints?selected=<id>&issue=<KEY>)。 */
export default async function SprintIssuePage({ params }: { params: Promise<{ id: string; key: string }> }) {
  const { id, key } = await params;
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <SprintsClient sprintId={id} issueKey={key} />
    </React.Suspense>
  );
}
