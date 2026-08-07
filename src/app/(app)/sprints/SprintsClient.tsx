'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { SprintsView } from '@/components/ScrumViews';
import { IssueDetail } from '@/components/IssueDetail';

/* 迭代 Sprint — 选中迭代由 /sprints/<sprintId> 路径驱动;看板上的 Issue 详情
   抽屉是嵌套路径 /sprints/<sprintId>/issues/<KEY>。 */
export default function SprintsClient({
  sprintId = null,
  issueKey = null,
}: {
  sprintId?: string | null;
  issueKey?: string | null;
}) {
  const router = useRouter();
  // 详情抽屉翻页的上下文列表:迭代看板按列展示顺序上报(TKT-26)。
  const [navKeys, setNavKeys] = React.useState<string[]>([]);

  const onSelectSprint = React.useCallback(
    (id: string) => router.push(id ? `/sprints/${id}` : '/sprints'),
    [router],
  );
  const setIssue = React.useCallback(
    (key: string | null, forSprintId?: string | null) => {
      const sid = forSprintId ?? sprintId;
      if (key && sid) router.push(`/sprints/${sid}/issues/${encodeURIComponent(key)}`);
      else if (sid) router.push(`/sprints/${sid}`);
      else router.push('/sprints');
    },
    [router, sprintId],
  );

  return (
    <>
      <SprintsView sprint={sprintId} onSelectSprint={onSelectSprint} onOpen={(sid, key) => setIssue(key, sid)} onVisibleKeysChange={setNavKeys} />
      {issueKey && <IssueDetail id={issueKey} onClose={() => setIssue(null)} onOpen={(key) => setIssue(key)} listKeys={navKeys} />}
    </>
  );
}
