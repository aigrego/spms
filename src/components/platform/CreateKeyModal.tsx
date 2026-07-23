'use client';

import * as React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Copy, Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import type { McpCapability } from '@/lib/platformApi';
import { ProjectIcon } from '@/components/glyphs/misc';
import { useCompanies, useCompanyMembers, useCreateMcpKey, usePlatformUsers } from '@/store/platform';
import { useAppData } from '@/store/AppData';
import { fieldLabel, inputCls } from './common';
import { cn } from '@/lib/utils';

const CAP_OPTIONS: { key: McpCapability; label: string; desc: React.ReactNode }[] = [
  { key: 'read', label: '读取', desc: '列表 / 详情 / 搜索 / 参考数据聚合' },
  { key: 'write', label: '写入', desc: '创建 / 更新 / 评论 / 移动到迭代(终态仍留给人工)' },
  {
    key: 'delete',
    label: '删除',
    desc: <span className="text-danger">预留:当前无删除类工具 —— 仅在未来需要时勾选</span>,
  },
];

const EXPIRY_OPTIONS: { label: string; days: number | null }[] = [
  { label: '30 天', days: 30 },
  { label: '90 天', days: 90 },
  { label: '180 天', days: 180 },
  { label: '365 天', days: 365 },
  { label: '永不过期', days: null },
];

function CapRow({
  checked,
  onToggle,
  label,
  desc,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  desc: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-start gap-2.5 border-b border-border px-3 py-2.5 text-left last:border-b-0 hover:bg-surface-2/60"
    >
      <span
        className={cn(
          'mt-0.5 grid h-4 w-4 flex-none place-items-center rounded-full border',
          checked ? 'border-brand-blue bg-brand-blue text-white' : 'border-border-strong bg-surface',
        )}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium text-fg-1">{label}</span>
        <span className="block text-[12px] text-fg-3">{desc}</span>
      </span>
    </button>
  );
}

/* 所属人候选。管理员:选了公司 → 该公司成员(平台接口);全平台 → 全部用户。
   非管理员(自助):当前公司 bootstrap 的 human 成员(平台 members 接口是
   管理员专属)。返回值是 { id: users.id, name } 列表。 */
export function useOwnerCandidates(platformAdmin: boolean, companyId: string | null) {
  const { members } = useAppData();
  const companyMembers = useCompanyMembers(platformAdmin ? companyId : null);
  const platformUsers = usePlatformUsers(platformAdmin && !companyId);
  if (platformAdmin) {
    if (companyId) {
      return (companyMembers.data ?? []).map((m) => ({ id: m.user.id, name: m.user.name }));
    }
    return (platformUsers.data ?? []).map((u) => ({ id: u.userId, name: u.name }));
  }
  return members
    .filter((m) => m.type === 'human' && (m as { userId?: string | null }).userId)
    .map((m) => ({ id: (m as { userId?: string | null }).userId as string, name: m.name }));
}

/* 新建 Agent 令牌:名称 + 能力上限(read/write/delete)+ 范围(全平台/某公司)
   + 所属人(默认自己)+ 有效期。成功后明文 key 仅本次返回,弹出一次性展示对话框。
   platformAdmin=false(member 自助)时隐藏范围选择,令牌自动归属当前公司。 */
export function CreateKeyModal({
  open,
  onOpenChange,
  onIssued,
  platformAdmin,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onIssued: (issued: { id: string; key: string; prefix: string }) => void;
  platformAdmin: boolean;
}) {
  const { data: companies = [] } = useCompanies(platformAdmin);
  const { projects, currentCompany } = useAppData();
  const create = useCreateMcpKey();

  const [name, setName] = React.useState('');
  const [caps, setCaps] = React.useState<McpCapability[]>(['read', 'write']);
  const [companyId, setCompanyId] = React.useState<string>(''); // '' = 全平台
  const [ownerId, setOwnerId] = React.useState<string>(''); // '' = 我自己(创建人)
  const [projectSel, setProjectSel] = React.useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = React.useState<number | null>(30);
  const [error, setError] = React.useState<string | null>(null);

  const ownerOptions = useOwnerCandidates(platformAdmin, platformAdmin ? companyId || null : null);

  /* 项目白名单只在「key 归属公司 = 当前 bootstrap 公司」时可选（平台管理员为
     其他公司/全平台建 key 时拿不到那边项目列表，退化为不限制）。 */
  const showWhitelist = projects.length > 0 && (!platformAdmin || companyId === currentCompany?.id);

  React.useEffect(() => {
    if (!open) return;
    setName('');
    setCaps(['read', 'write']);
    setCompanyId('');
    setOwnerId('');
    setProjectSel(projects.map((p) => p.id));
    setExpiresInDays(30);
    setError(null);
  }, [open, projects]);

  // 切换范围时已选所属人可能不在新公司候选里,随范围一起重置回"我自己"。
  const changeCompany = (v: string) => {
    setCompanyId(v);
    setOwnerId('');
  };

  const toggleCap = (c: McpCapability) =>
    setCaps((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  const toggleProject = (id: string) =>
    setProjectSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const submit = async () => {
    setError(null);
    try {
      const issued = await create.mutateAsync({
        name: name.trim(),
        // member 不传 companyId —— 服务端自动归属其当前公司
        companyId: platformAdmin ? companyId || null : undefined,
        ownerId: ownerId || undefined,
        capabilities: caps,
        expiresInDays,
        // 全选 = 不限制（与存量令牌一致，存 NULL）
        projectIds: showWhitelist && projectSel.length < projects.length ? projectSel : null,
      });
      onOpenChange(false);
      onIssued(issued);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '创建失败,请重试');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="w-[min(480px,92vw)]">
        <DialogPrimitive.Title className="px-[18px] pb-1 pt-4 text-[15px] font-semibold text-fg-1">
          新建 Agent 令牌
        </DialogPrimitive.Title>
        <div className="flex flex-col gap-3 px-[18px] py-3">
          <div>
            <span className={fieldLabel}>名称</span>
            <input
              autoFocus
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如:Claude Code · 本机"
            />
          </div>
          <div>
            <span className={fieldLabel}>能力(令牌上限)</span>
            <div className="overflow-hidden rounded-lg border border-border">
              {CAP_OPTIONS.map((o) => (
                <CapRow
                  key={o.key}
                  checked={caps.includes(o.key)}
                  onToggle={() => toggleCap(o.key)}
                  label={o.label}
                  desc={o.desc}
                />
              ))}
            </div>
          </div>
          {showWhitelist && (
            <div>
              <span className={fieldLabel}>项目白名单</span>
              <div className="mb-1.5 text-[12px] text-fg-3">
                Agent 只能访问选中项目内的实体(全部选中 = 不限制)
              </div>
              <div className="max-h-40 overflow-y-auto overflow-hidden rounded-lg border border-border">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleProject(p.id)}
                    className="flex w-full items-center gap-2.5 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-surface-2/60"
                  >
                    <span
                      className={cn(
                        'grid h-4 w-4 flex-none place-items-center rounded-full border',
                        projectSel.includes(p.id)
                          ? 'border-brand-blue bg-brand-blue text-white'
                          : 'border-border-strong bg-surface',
                      )}
                    >
                      {projectSel.includes(p.id) && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span
                      className="grid h-4 w-4 flex-none place-items-center rounded"
                      style={{ background: p.color }}
                    >
                      <ProjectIcon name={p.icon} size={11} />
                    </span>
                    <span className="min-w-0 truncate text-[13.5px] font-medium text-fg-1">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {platformAdmin && (
            <div>
              <span className={fieldLabel}>范围</span>
              <select className={inputCls} value={companyId} onChange={(e) => changeCompany(e.target.value)}>
                <option value="">全平台</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <span className={fieldLabel}>所属人(Agent 以此身份操作)</span>
            <select className={inputCls} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">我自己(默认)</option>
              {ownerOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className={fieldLabel}>有效期</span>
            <select
              className={inputCls}
              value={expiresInDays === null ? 'never' : String(expiresInDays)}
              onChange={(e) => setExpiresInDays(e.target.value === 'never' ? null : Number(e.target.value))}
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.label} value={o.days === null ? 'never' : String(o.days)}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {error && <div className="rounded-lg bg-danger-50 px-3 py-2 text-[12.5px] text-danger">{error}</div>}
        </div>
        <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
          <div className="flex-1" />
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={submit}
            disabled={
              !name.trim() ||
              caps.length === 0 ||
              (showWhitelist && projectSel.length === 0) ||
              create.isPending
            }
          >
            创建令牌
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* 一次性明文 Key 展示 — 关闭后不再可见。 */
export function KeyRevealDialog({
  issued,
  onClose,
}: {
  issued: { id: string; key: string; prefix: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    setCopied(false);
  }, [issued]);

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.key);
      setCopied(true);
    } catch {
      // clipboard may be unavailable (non-secure context) — the key is selectable anyway
    }
  };

  return (
    <Dialog open={!!issued} onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[min(520px,92vw)]">
        <DialogPrimitive.Title className="px-[18px] pb-1 pt-4 text-[15px] font-semibold text-fg-1">
          令牌创建成功
        </DialogPrimitive.Title>
        <div className="flex flex-col gap-3 px-[18px] py-3">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
            <code className="min-w-0 flex-1 select-all break-all font-mono text-[13px] text-fg-1">{issued?.key}</code>
            <Button variant="secondary" size="sm" onClick={copy} className="flex-none">
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? '已复制' : '复制'}
            </Button>
          </div>
          <div className="flex items-start gap-2 rounded-lg bg-warning-50 px-3 py-2 text-[12.5px] leading-relaxed text-[#7A5300]">
            <AlertTriangle size={14} className="mt-0.5 flex-none" />
            请立即保存此令牌,关闭后不再显示。
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
          <div className="flex-1" />
          <Button variant="primary" size="md" onClick={onClose}>
            我已保存,关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
