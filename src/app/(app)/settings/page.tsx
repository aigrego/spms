import * as React from 'react';
import SettingsClient from './SettingsClient';
import { Skeleton } from '@/components/StateBlock';

export default function SettingsPage() {
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <SettingsClient />
    </React.Suspense>
  );
}
