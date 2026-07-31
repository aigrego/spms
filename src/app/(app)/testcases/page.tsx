import * as React from 'react';
import { redirect } from 'next/navigation';
import TestCasesClient from './TestCasesClient';
import { Skeleton } from '@/components/StateBlock';

/* /testcases — 测试用例(?project=<id> 项目筛选)。旧深链 ?selected=<id>
   301 到 /testcases/<id>。 */
export default async function TestCasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const project = typeof sp.project === 'string' ? sp.project : undefined;
  if (typeof sp.selected === 'string' && sp.selected) {
    const qs = project ? `?project=${encodeURIComponent(project)}` : '';
    redirect(`/testcases/${encodeURIComponent(sp.selected)}${qs}`);
  }
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <TestCasesClient project={project} />
    </React.Suspense>
  );
}
