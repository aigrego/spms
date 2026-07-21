import * as React from 'react';
import SprintsClient from './SprintsClient';
import { Skeleton } from '@/components/StateBlock';

export default function SprintsPage() {
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <SprintsClient />
    </React.Suspense>
  );
}
