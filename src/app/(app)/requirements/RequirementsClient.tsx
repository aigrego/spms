'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RequirementsView } from '@/components/RequirementsView';

/* 需求池 — /requirements。项目筛选仍是查询参数 ?project=<id>(项目枢纽跳入);
   详情抽屉由路径驱动:/requirements/<KEY>。 */
export default function RequirementsClient({
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
      router.push(id ? `/requirements/${encodeURIComponent(id)}${qs}` : `/requirements${qs}`);
    },
    [router, project],
  );

  return (
    <RequirementsView
      project={project}
      selected={selected}
      onSelect={setSelected}
    />
  );
}
