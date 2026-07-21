import * as React from 'react';
import RequirementsClient from './RequirementsClient';
import { Skeleton } from '@/components/StateBlock';

export default function RequirementsPage() {
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <RequirementsClient />
    </React.Suspense>
  );
}
