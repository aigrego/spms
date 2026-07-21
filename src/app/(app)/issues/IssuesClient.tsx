'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { IssuesView } from '@/components/IssuesView';
import { IssueDetail } from '@/components/IssueDetail';
import { useShell } from '@/components/AppShell';
import { useAppData } from '@/store/AppData';
import { useIssues, useUpdateIssue } from '@/store/issues';
import { useT } from '@/lib/i18n';
import type { UpdateIssueInput } from '@/lib/api';

/* Issues 视图 — /issues（全部）与 /issues?assignee=me（我的）。
   详情抽屉由 URL 驱动：?selected=<KEY>。 */
export default function IssuesClient() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { meId } = useAppData();
  const { openNewIssue } = useShell();

  const isMine = searchParams.get('assignee') === 'me';
  const selected = searchParams.get('selected');

  const params = React.useMemo(
    () => (isMine ? (meId ? { assignee: meId } : {}) : {}),
    [isMine, meId],
  );
  const { data: issues = [] } = useIssues(params);
  const update = useUpdateIssue();

  const onUpdate = React.useCallback(
    (id: string, patch: UpdateIssueInput) => update.mutate({ id, input: patch }),
    [update],
  );

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

  const meta = isMine
    ? { title: t('view.myIssues'), subtitle: t('view.myIssuesSub') }
    : { title: t('nav.allIssues'), subtitle: undefined };

  return (
    <>
      <IssuesView
        issues={issues}
        title={meta.title}
        subtitle={meta.subtitle}
        onOpen={(id) => setSelected(id)}
        onUpdate={onUpdate}
        onNewIssue={openNewIssue}
      />
      {selected && <IssueDetail id={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
