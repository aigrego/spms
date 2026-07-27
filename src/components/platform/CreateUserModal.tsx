'use client';

import * as React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { useCreateUser } from '@/store/platform';
import { fieldLabel, inputCls } from './common';

/* 新建系统账号:仅创建 users 行(平台角色 member),不含任何公司席位 —
   席位在公司卡片的「席位」抽屉里分配。 */
export function CreateUserModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const create = useCreateUser();

  const [username, setUsername] = React.useState('');
  const [name, setName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setUsername('');
    setName('');
    setPassword('');
    setEmail('');
    setError(null);
  }, [open]);

  const submit = async () => {
    setError(null);
    try {
      await create.mutateAsync({
        username: username.trim(),
        name: name.trim() || undefined,
        password,
        email: email.trim() || undefined,
      });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '创建失败,请重试');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="w-[min(480px,92vw)]">
        <DialogPrimitive.Title className="px-[18px] pb-1 pt-4 text-[15px] font-semibold text-fg-1">
          新建用户
        </DialogPrimitive.Title>
        <div className="flex flex-col gap-3 px-[18px] py-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <span className={fieldLabel}>用户名(必填)</span>
              <input
                autoFocus
                className={inputCls}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="登录用户名"
              />
            </div>
            <div className="flex-1">
              <span className={fieldLabel}>姓名(可选)</span>
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="缺省 = 用户名"
              />
            </div>
          </div>
          <div>
            <span className={fieldLabel}>初始密码(必填,≥6 位)</span>
            <input
              type="password"
              className={inputCls}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div>
            <span className={fieldLabel}>邮箱(可选)</span>
            <input
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com,可用于登录与指派人匹配"
            />
          </div>
          <p className="text-[12px] leading-relaxed text-fg-3">
            新用户不属于任何公司;到「公司管理」的公司卡片 → 席位,把他加入对应公司沙箱。
          </p>
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
            disabled={!username.trim() || password.length < 6 || create.isPending}
          >
            创建用户
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
