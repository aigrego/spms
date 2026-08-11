'use client';

import * as React from 'react';
import { Save, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton, StateBlock } from '@/components/StateBlock';
import { useCompanyMatrix, usePermissionsMatrix, useSaveCompanyMatrix, useSavePermissionsMatrix } from '@/store/platform';
import { MODULE_LABELS, PERM_LEVEL_LABELS, ROLE_LABELS } from '@/lib/platformApi';
import type { CompanyRole, PermLevel } from '@/lib/platformApi';
import { PlatformHeader, tdCls, thCls } from '@/components/platform/common';
import { useT } from '@/lib/i18n';

type MatrixDraft = Record<string, Record<string, PermLevel>>;

const LEVEL_TONE: Record<PermLevel, string> = {
  none: 'var(--fg-3)',
  read: 'var(--brand-blue)',
  write: 'var(--success-500)',
};

/* 权限矩阵：行 = 模块，列 = 4 个可配角色，单元格 = 不可见/只读/读写。
   公司管理员不在矩阵内（恒为全部权限）。本地草稿 + 脏检查，整体 PUT 保存。
   scope='global' 编辑全局默认(平台管理员);scope='company' 编辑本公司覆盖
   (company_admin,生效值为 全局 + 覆盖 的合并)。 */
export function MatrixPanel({ scope = 'global' }: { scope?: 'global' | 'company' }) {
  const t = useT();
  const isGlobal = scope === 'global';
  const globalQ = usePermissionsMatrix(isGlobal);
  const companyQ = useCompanyMatrix(!isGlobal);
  const { data, isLoading, isError } = isGlobal ? globalQ : companyQ;
  const saveGlobal = useSavePermissionsMatrix();
  const saveCompany = useSaveCompanyMatrix();
  const save = isGlobal ? saveGlobal : saveCompany;
  const [draft, setDraft] = React.useState<MatrixDraft | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);

  // 服务端数据到达后初始化草稿；保存成功后缓存失效重取，用 latest 数据重置草稿。
  React.useEffect(() => {
    if (data) setDraft(JSON.parse(JSON.stringify(data.matrix)) as MatrixDraft);
  }, [data]);

  const dirty = !!data && !!draft && JSON.stringify(draft) !== JSON.stringify(data.matrix);

  const setCell = (role: string, module: string, level: PermLevel) => {
    setDraft((d) => (d ? { ...d, [role]: { ...d[role], [module]: level } } : d));
  };

  const submit = () => {
    if (!draft) return;
    save.mutate(draft, {
      onSuccess: () => {
        setSavedAt(Date.now());
        setTimeout(() => setSavedAt(null), 3000);
      },
    });
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PlatformHeader title={isGlobal ? t('matrix.titleGlobal') : t('matrix.titleCompany')}>
        {savedAt && (
          <span className="inline-flex items-center gap-1 text-[12.5px] font-medium" style={{ color: 'var(--success-500)' }}>
            <Check size={13} /> {t('profile.saved')}
          </span>
        )}
        <Button variant="primary" size="md" onClick={submit} disabled={!dirty || save.isPending}>
          <Save size={14} /> {t('common.save')}
        </Button>
      </PlatformHeader>
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <Skeleton rows={6} />
        ) : isError || !data || !draft ? (
          <StateBlock icon="alert" tone="danger" title={t('matrix.loadFailed')} body={t('platform.common.retry')} />
        ) : (
          <div className="max-w-[860px]">
            <p className="mb-4 mt-0 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed text-fg-2">
              {isGlobal ? t('matrix.descGlobal') : t('matrix.descCompany')}
            </p>
            <table className="w-full border-collapse rounded-lg border border-border bg-surface">
              <thead>
                <tr className="border-b border-border">
                  <th className={thCls} style={{ paddingLeft: 16 }}>{t('matrix.module')}</th>
                  {data.roles.map((r) => (
                    <th key={r} className={thCls} style={{ textAlign: 'center' }}>
                      {r in ROLE_LABELS ? t(`role.${r}`) : r}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.modules.map((mod) => (
                  <tr key={mod} className="border-b border-border last:border-b-0 hover:bg-surface-2/60">
                    <td className={tdCls} style={{ paddingLeft: 16 }}>
                      <span className="font-medium">{mod in MODULE_LABELS ? t(`platform.module.${mod}`) : mod}</span>
                    </td>
                    {data.roles.map((r) => {
                      const level = draft[r]?.[mod] ?? 'none';
                      return (
                        <td key={r} className={tdCls} style={{ textAlign: 'center' }}>
                          <select
                            className="h-7 rounded-md border border-border-strong bg-surface px-1.5 text-[12.5px] outline-none focus:border-brand-blue"
                            style={{ color: LEVEL_TONE[level], fontWeight: level === 'none' ? 400 : 500 }}
                            value={level}
                            onChange={(e) => setCell(r, mod, e.target.value as PermLevel)}
                          >
                            {(Object.keys(PERM_LEVEL_LABELS) as PermLevel[]).map((lv) => (
                              <option key={lv} value={lv} style={{ color: 'var(--fg-1)' }}>
                                {t(`platform.permLevel.${lv}`)}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {save.isError && (
              <div className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-[12.5px] text-danger">{t('platform.common.saveFailed')}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
