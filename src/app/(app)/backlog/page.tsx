import * as React from 'react';
import BacklogClient from './BacklogClient';
import { Skeleton } from '@/components/StateBlock';

export default function BacklogPage() {
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <BacklogClient />
    </React.Suspense>
  );
}
