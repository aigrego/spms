'use client';

import * as React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { useCreateCompany, useUpdateCompany } from '@/store/platform';
import type { PlatformCompany } from '@/lib/platformApi';
import { fieldLabel, inputCls } from './common';

const SWATCHES = ['#0063D3', '#1F9D55', '#7A5AE0', '#D89400', '#D6293E', '#0EA5A5', '#DB5A00'];
const KEY_RE = /^[a-z0-9-]+$/;

/* 新建 / 编辑公司。key 仅创建时可填（小写字母/数字/连字符），服务端唯一性
   冲突等业务错误内联展示。 */
export function CompanyModal({
  open,
  onOpenChange,
  company,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  company?: PlatformCompany | null;
}) {
  const create = useCreateCompany();
  const update = useUpdateCompany();
  const editing = !!company;

  const [name, setName] = React.useState('');
  const [key, setKey] = React.useState('');
  const [color, setColor] = React.useState(SWATCHES[0]);
  const [description, setDescription] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(company?.name ?? '');
    setKey(company?.key ?? '');
    setColor(company?.color ?? SWATCHES[0]);
    setDescription(company?.description ?? '');
    setError(null);
  }, [open, company]);

  const keyValid = editing || KEY_RE.test(key.trim());
  const canSubmit = !!name.trim() && keyValid && !create.isPending && !update.isPending;

  const submit = async () => {
    setError(null);
    try {
      if (editing) {
        await update.mutateAsync({
          id: company!.id,
          input: { name: name.trim(), color, description: description.trim() || undefined },
        });
      } else {
        await create.mutateAsync({
          key: key.trim(),
          name: name.trim(),
          color,
          description: description.trim() || undefined,
        });
      }
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存失败，请重试');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="w-[min(480px,92vw)]">
        <DialogPrimitive.Title className="px-[18px] pb-1 pt-4 text-[15px] font-semibold text-fg-1">
          {editing ? '编辑公司' : '新建公司'}
        </DialogPrimitive.Title>
        <div className="flex flex-col gap-3 px-[18px] py-3">
          <div>
            <span className={fieldLabel}>名称</span>
            <input
              autoFocus
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：灵核科技"
            />
          </div>
          <div>
            <span className={fieldLabel}>Key（小写字母 / 数字 / 连字符，唯一）</span>
            <input
              className={inputCls}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="例如：innev"
              disabled={editing}
              style={editing ? { opacity: 0.5 } : undefined}
            />
            {!keyValid && (
              <div className="mt-1 text-[12px] text-danger">key 只能包含小写字母、数字和连字符</div>
            )}
          </div>
          <div>
            <span className={fieldLabel}>颜色</span>
            <div className="flex gap-1.5">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  aria-label={c}
                  className="h-6 w-6 rounded-md transition-transform hover:scale-110"
                  style={{ background: c, outline: color === c ? '2px solid var(--fg-1)' : 'none', outlineOffset: 1 }}
                />
              ))}
            </div>
          </div>
          <div>
            <span className={fieldLabel}>描述（可选）</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-lg border border-border-strong bg-surface px-2.5 py-2 text-[13px] leading-relaxed text-fg-1 outline-none focus:border-brand-blue"
            />
          </div>
          {error && <div className="rounded-lg bg-danger-50 px-3 py-2 text-[12.5px] text-danger">{error}</div>}
        </div>
        <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
          <div className="flex-1" />
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            {editing ? '保存' : '新建公司'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
