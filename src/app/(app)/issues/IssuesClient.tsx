'use client';

import { useShell } from '@/components/AppShell';
import { IssueDetail } from '@/components/IssueDetail';
import { IssuesView } from '@/components/IssuesView';
import type { UpdateIssueInput } from '@/lib/api';
import { usePersistentState } from '@/lib/prefs';
import { useT } from '@/lib/i18n';
import { useAppData } from '@/store/AppData';
import { useIssues, useUpdateIssue } from '@/store/issues';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/* Issues 视图 — /issues（全部）与 /my-issues（我的）。
   详情抽屉由路径驱动：/issues/<KEY>、/my-issues/<KEY>。 */
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';

export default function IssuesClient({
  view = 'all',
  selected = null,
}: {
  view?: 'all' | 'mine';
  selected?: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const { meId } = useAppData();
  const { openNewIssue } = useShell();

  const isMine = view === 'mine';
  const basePath = isMine ? '/my-issues' : '/issues';
  // 「显示已归档」开关:默认隐藏已归档 issue 及已归档项目的 issue;记入浏览器记忆。
  const [showArchived, setShowArchived] = usePersistentState<boolean>(
    'issues.showArchived',
    false,
    isBoolean,
  );

  // 「显示已归档」开启时放开已完成的一周限制(recentDone opt-in,其他消费方拿全量)。
  const params = React.useMemo(
    () => ({
      ...(isMine ? (meId ? { assignee: meId } : {}) : {}),
      includeArchived: showArchived,
      recentDone: !showArchived,
    }),
    [isMine, meId, showArchived],
  );
  const { data: issues = [] } = useIssues(params);
  const update = useUpdateIssue();
  // 详情抽屉翻页的上下文列表:视图按当前过滤/分组的展示顺序上报(TKT-26)。
  const [navKeys, setNavKeys] = React.useState<string[]>([]);

  const onUpdate = React.useCallback(
    (id: string, patch: UpdateIssueInput) => update.mutate({ id, input: patch }),
    [update],
  );

  const setSelected = React.useCallback(
    (key: string | null) => {
      router.push(key ? `${basePath}/${encodeURIComponent(key)}` : basePath);
    },
    [router, basePath],
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
        onVisibleKeysChange={setNavKeys}
      />
      {selected && <IssueDetail id={selected} onClose={() => setSelected(null)} onOpen={(key) => setSelected(key)} listKeys={navKeys} />}
    </>
  );
}
