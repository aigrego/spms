'use client';

import { useShell } from '@/components/AppShell';
import { IssueDetail } from '@/components/IssueDetail';
import { IssuesView } from '@/components/IssuesView';
import type { UpdateIssueInput } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useAppData } from '@/store/AppData';
import { useIssues, useUpdateIssue } from '@/store/issues';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

/* Issues 视图 — /issues（全部）与 /issues?assignee=me（我的）。
   详情抽屉由 URL 驱动：?selected=<KEY>。 
*/
export default function IssuesClient() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { meId } = useAppData();
  const { openNewIssue } = useShell();

  const isMine = searchParams.get('assignee') === 'me';
  const selected = searchParams.get('selected');
  // 「显示已归档」开关:默认隐藏已归档 issue 及已归档项目的 issue。
  const [showArchived, setShowArchived] = React.useState(false);

  const params = React.useMemo(
    () => ({ ...(isMine ? (meId ? { assignee: meId } : {}) : {}), includeArchived: showArchived }),
    [isMine, meId, showArchived],
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
        showArchived={showArchived}
        onToggleArchived={setShowArchived}
        onOpen={(id) => setSelected(id)}
        onUpdate={onUpdate}
        onNewIssue={openNewIssue}
      />
      {selected && <IssueDetail id={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
