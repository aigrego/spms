import * as React from 'react';
import RequirementsClient from '../RequirementsClient';
import { Skeleton } from '@/components/StateBlock';

/* /requirements/<KEY> — 需求池 + 指定需求的详情抽屉(原 /requirements?selected=<KEY>)。 */
export default async function RequirementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { key } = await params;
  const sp = await searchParams;
  const project = typeof sp.project === 'string' ? sp.project : undefined;
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <RequirementsClient project={project} selected={key} />
    </React.Suspense>
  );
}
