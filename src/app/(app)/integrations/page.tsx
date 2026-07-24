import * as React from 'react';
import IntegrationsClient from './IntegrationsClient';
import { Skeleton } from '@/components/StateBlock';

export default function IntegrationsPage() {
  return (
    <React.Suspense fallback={<Skeleton rows={6} />}>
      <IntegrationsClient />
    </React.Suspense>
  );
}
