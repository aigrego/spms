import * as React from 'react';
import TestCasesClient from './TestCasesClient';
import { Skeleton } from '@/components/StateBlock';

export default function TestCasesPage() {
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <TestCasesClient />
    </React.Suspense>
  );
}
