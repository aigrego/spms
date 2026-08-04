import * as React from 'react';
import ReportsClient from './ReportsClient';
import { Skeleton } from '@/components/StateBlock';

/* /reports — 日报:写日报 + 日报汇总(项目 → 人员 → 任务)。 */
export default function ReportsPage() {
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <ReportsClient />
    </React.Suspense>
  );
}
