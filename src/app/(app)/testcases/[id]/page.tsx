import * as React from 'react';
import TestCasesClient from '../TestCasesClient';
import { Skeleton } from '@/components/StateBlock';

/* /testcases/<id> — 测试用例 + 指定用例的详情抽屉(原 /testcases?selected=<id>)。 */
export default async function TestCaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const project = typeof sp.project === 'string' ? sp.project : undefined;
  return (
    <React.Suspense fallback={<Skeleton rows={9} />}>
      <TestCasesClient project={project} selected={id} />
    </React.Suspense>
  );
}
