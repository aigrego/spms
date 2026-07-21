'use client';

import * as React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { useAddMember } from '@/store/platform';
import { ROLE_LABELS } from '@/lib/platformApi';
import type { CompanyRole } from '@/lib/platformApi';
import { fieldLabel, inputCls } from './common';

/* 添加成员：username 已存在则直接加入；不存在且给了初始密码则新建用户并加入。
   业务错误（用户不存在且未提供初始密码 / 已是成员）内联展示。 */
export function AddMemberModal({
  open,
  onOpenChange,
  companyId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companyId: string;
}) {
  const add = useAddMember(companyId);

  const [username, setUsername] = React.useState('');
  const [role, setRole] = React.useState<CompanyRole>('developer');
  const [name, setName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setUsername('');
    setRole('developer');
    setName('');
    setPassword('');
    setError(null);
  }, [open]);

  const submit = async () => {
    setError(null);
    try {
      await add.mutateAsync({
        username: username.trim(),
        role,
        name: name.trim() || undefined,
        password: password || undefined,
      });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '添加失败，请重试');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="w-[min(480px,92vw)]">
        <DialogPrimitive.Title className="px-[18px] pb-1 pt-4 text-[15px] font-semibold text-fg-1">
          添加成员
        </DialogPrimitive.Title>
        <div className="flex flex-col gap-3 px-[18px] py-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <span className={fieldLabel}>用户名（必填）</span>
              <input
                autoFocus
                className={inputCls}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="登录用户名"
              />
            </div>
            <div className="w-[140px]">
              <span className={fieldLabel}>角色</span>
              <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as CompanyRole)}>
                {(Object.keys(ROLE_LABELS) as CompanyRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <span className={fieldLabel}>姓名（可选）</span>
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="缺省 = 用户名"
              />
            </div>
            <div className="flex-1">
              <span className={fieldLabel}>初始密码（可选）</span>
              <input
                type="password"
                className={inputCls}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="留空则用户名必须已存在"
              />
            </div>
          </div>
          {error && <div className="rounded-lg bg-danger-50 px-3 py-2 text-[12.5px] text-danger">{error}</div>}
        </div>
        <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
          <div className="flex-1" />
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!username.trim() || add.isPending}>
            添加成员
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
