import * as React from 'react';
import { redirect } from 'next/navigation';
import RequirementsClient from './RequirementsClient';
import { Skeleton } from '@/components/StateBlock';

/* /requirements — 需求池(?project=<id> 项目筛选)。旧深链 ?selected=<KEY>
   301 到 /requirements/<KEY>。 */
export default async function RequirementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const project = typeof sp.project === 'string' ? sp.project : undefined;
  if (typeof sp.selected === 'string' && sp.selected) {
    const qs = project ? `?project=${encodeURIComponent(project)}` : '';
    redirect(`/requirements/${encodeURIComponent(sp.selected)}${qs}`);
  }
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <RequirementsClient project={project} />
    </React.Suspense>
  );
}
