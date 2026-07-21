import * as React from 'react';
import IssuesClient from './IssuesClient';
import { Skeleton } from '@/components/StateBlock';

export default function IssuesPage() {
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <IssuesClient />
    </React.Suspense>
  );
}
