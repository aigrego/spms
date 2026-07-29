'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { BacklogView } from '@/components/ScrumViews';
import { IssueDetail } from '@/components/IssueDetail';

/* 产品待办 Backlog — 拖拽规划到右侧迭代；Issue 详情抽屉由 ?selected=<KEY> 驱动
   （与 /issues 页一致）。 */
export default function BacklogClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selected = searchParams.get('selected');

  const setSelected = React.useCallback(
    (key: string | null) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (key) sp.set('selected', key);
      else sp.delete('selected');
      const qs = sp.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  return (
    <>
      <BacklogView onOpen={(id) => setSelected(id)} />
      {selected && <IssueDetail id={selected} onClose={() => setSelected(null)} onOpen={(key) => setSelected(key)} />}
    </>
  );
}
