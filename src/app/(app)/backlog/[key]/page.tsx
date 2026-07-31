import * as React from 'react';
import BacklogClient from '../BacklogClient';
import { Skeleton } from '@/components/StateBlock';

/* /backlog/<KEY> — 产品待办 + 指定 issue 的详情抽屉(原 /backlog?selected=<KEY>)。 */
export default async function BacklogIssuePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <BacklogClient selected={key} />
    </React.Suspense>
  );
}
