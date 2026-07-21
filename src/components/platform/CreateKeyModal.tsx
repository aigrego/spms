'use client';

import * as React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Copy, Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { useCompanies, useCreateMcpKey } from '@/store/platform';
import { fieldLabel, inputCls } from './common';

/* 签发 MCP Key：名称 + 范围（全平台 / 某公司）。成功后明文 key 仅本次返回，
   弹出一次性展示对话框（等宽字体 + 复制 + 警示）。 */
export function CreateKeyModal({
  open,
  onOpenChange,
  onIssued,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onIssued: (issued: { id: string; key: string; prefix: string }) => void;
}) {
  const { data: companies = [] } = useCompanies();
  const create = useCreateMcpKey();

  const [name, setName] = React.useState('');
  const [companyId, setCompanyId] = React.useState<string>(''); // '' = 全平台
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName('');
    setCompanyId('');
    setError(null);
  }, [open]);

  const submit = async () => {
    setError(null);
    try {
      const issued = await create.mutateAsync({ name: name.trim(), companyId: companyId || null });
      onOpenChange(false);
      onIssued(issued);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '签发失败，请重试');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="w-[min(480px,92vw)]">
        <DialogPrimitive.Title className="px-[18px] pb-1 pt-4 text-[15px] font-semibold text-fg-1">
          签发 Key
        </DialogPrimitive.Title>
        <div className="flex flex-col gap-3 px-[18px] py-3">
          <div>
            <span className={fieldLabel}>名称</span>
            <input
              autoFocus
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：CI 构建机器人"
            />
          </div>
          <div>
            <span className={fieldLabel}>范围</span>
            <select className={inputCls} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">全平台</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
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
          <Button variant="primary" size="md" onClick={submit} disabled={!name.trim() || create.isPending}>
            签发
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
          Key 签发成功
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
            请立即保存此 Key，关闭后不再显示。
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
          <div className="flex-1" />
          <Button variant="primary" size="md" onClick={onClose}>
            我已保存，关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
