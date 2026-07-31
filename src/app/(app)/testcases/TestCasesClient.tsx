'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { TestCasesView } from '@/components/TestCasesView';

/* 测试用例 — /testcases。项目筛选仍是查询参数 ?project=<id>(项目枢纽跳入);
   详情抽屉由路径驱动:/testcases/<id>。 */
export default function TestCasesClient({
  project,
  selected = null,
}: {
  project?: string;
  selected?: string | null;
}) {
  const router = useRouter();

  const setSelected = React.useCallback(
    (id: string | null) => {
      const qs = project ? `?project=${encodeURIComponent(project)}` : '';
      router.push(id ? `/testcases/${encodeURIComponent(id)}${qs}` : `/testcases${qs}`);
    },
    [router, project],
  );

  return (
    <TestCasesView
      project={project}
      selected={selected}
      onSelect={setSelected}
    />
  );
}
