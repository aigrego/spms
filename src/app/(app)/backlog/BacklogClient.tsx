'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { BacklogView } from '@/components/ScrumViews';
import { IssueDetail } from '@/components/IssueDetail';

/* 产品待办 Backlog — 拖拽规划到右侧迭代;Issue 详情抽屉由 /backlog/<KEY> 驱动。 */
export default function BacklogClient({ selected = null }: { selected?: string | null }) {
  const router = useRouter();

  const setSelected = React.useCallback(
    (key: string | null) => {
      router.push(key ? `/backlog/${encodeURIComponent(key)}` : '/backlog');
    },
    [router],
  );

  return (
    <>
      <BacklogView onOpen={(id) => setSelected(id)} />
      {selected && <IssueDetail id={selected} onClose={() => setSelected(null)} onOpen={(key) => setSelected(key)} />}
    </>
  );
}
