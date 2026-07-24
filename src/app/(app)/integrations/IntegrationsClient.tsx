'use client';

import { NotionCard } from '@/components/NotionCard';
import { useT } from '@/lib/i18n';

/* /integrations — 第三方集成入口。目前只有 Notion(连接 / 配置 / 手动同步),
   后续其他集成(如 Slack、Jira)以卡片形式追加在这里。 */
export default function IntegrationsClient() {
  const t = useT();
  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-[860px]">
        <h1 className="text-[22px] font-bold text-fg-1">{t('settingsPage.notion')}</h1>
        <p className="mb-5 mt-1 text-[13px] text-fg-3">{t('settingsPage.notionDesc')}</p>
        <NotionCard />
      </div>
    </div>
  );
}
