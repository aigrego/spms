'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SprintsView } from '@/components/ScrumViews';
import { IssueDetail } from '@/components/IssueDetail';

/* 迭代 Sprint — 选中迭代由 ?selected=<sprintId> 深链驱动；看板上的 Issue 详情
   抽屉用独立的 ?issue=<KEY> 参数，避免覆盖迭代选择。 */
export default function SprintsClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selected = searchParams.get('selected');
  const issueKey = searchParams.get('issue');

  const push = React.useCallback(
    (mutate: (sp: URLSearchParams) => void) => {
      const sp = new URLSearchParams(searchParams.toString());
      mutate(sp);
      const qs = sp.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  const onSelectSprint = React.useCallback(
    (id: string) => push((sp) => (id ? sp.set('selected', id) : sp.delete('selected'))),
    [push],
  );
  const setIssue = React.useCallback(
    (key: string | null) => push((sp) => (key ? sp.set('issue', key) : sp.delete('issue'))),
    [push],
  );

  return (
    <>
      <SprintsView sprint={selected} onSelectSprint={onSelectSprint} onOpen={(id) => setIssue(id)} />
      {issueKey && <IssueDetail id={issueKey} onClose={() => setIssue(null)} onOpen={(key) => setIssue(key)} />}
    </>
  );
}
