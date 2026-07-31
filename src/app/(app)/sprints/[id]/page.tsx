import * as React from 'react';
import SprintsClient from '../SprintsClient';
import { Skeleton } from '@/components/StateBlock';

/* /sprints/<sprintId> — 指定迭代的看板(原 /sprints?selected=<id>)。 */
export default async function SprintBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <SprintsClient sprintId={id} />
    </React.Suspense>
  );
}
