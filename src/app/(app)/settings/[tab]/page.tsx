import * as React from 'react';
import SettingsClient from '../SettingsClient';
import { Skeleton } from '@/components/StateBlock';

/* /settings/<tab> — 指定 Tab 的设置页(companies/members/matrix/company-matrix,
   非法值回落 preferences)。 */
export default async function SettingsTabPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <SettingsClient tab={tab} />
    </React.Suspense>
  );
}
