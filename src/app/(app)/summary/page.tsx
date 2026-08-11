import * as React from 'react';
import SummaryClient from './SummaryClient';
import { Skeleton } from '@/components/StateBlock';

/* /summary — 团队总结:每日/每周周期的吞吐、周期时长与成员分列统计。 */
export default function SummaryPage() {
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <SummaryClient />
    </React.Suspense>
  );
}
