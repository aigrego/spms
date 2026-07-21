'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { RequirementsView } from '@/components/RequirementsView';

/* 需求池 — /requirements。项目筛选来自 ?project=<id>（项目枢纽跳入）；
   详情抽屉由 URL 驱动：?selected=<KEY>。 */
export default function RequirementsClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const project = searchParams.get('project');
  const selected = searchParams.get('selected');

  const setSelected = React.useCallback(
    (id: string | null) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (id) sp.set('selected', id);
      else sp.delete('selected');
      const qs = sp.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  return (
    <RequirementsView
      project={project ?? undefined}
      selected={selected}
      onSelect={setSelected}
    />
  );
}
