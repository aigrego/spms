'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, authApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useAppData } from '@/store/AppData';

const fieldLabel = 'mb-1 block text-[12px] font-medium text-fg-2';

/* Change-password form, shared by the profile page's security tab. Holds its
   own state; remount (tab switch) resets it. Extracted from the old
   SettingsModal.
   纯 OAuth 账号(hasPassword === false)没有旧密码 —— 隐藏旧密码输入,
   直接设置新密码即可开通密码登录。 */
export function ChangePasswordForm() {
  const t = useT();
  const { session } = useAppData();
  const qc = useQueryClient();
  const hasPassword = session?.user.hasPassword ?? true;
  const [oldPassword, setOldPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [okMsg, setOkMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    setError(null);
    setOkMsg(null);
    if (newPassword !== confirm) {
      setError(t('settings.passwordMismatch'));
      return;
    }
    setBusy(true);
    try {
      await authApi.changePassword(hasPassword ? oldPassword : undefined, newPassword);
      setOkMsg(t('settings.passwordChanged'));
      setOldPassword('');
      setNewPassword('');
      setConfirm('');
      // 首次设密码后 hasPassword 翻 true,隐藏旧密码说明文案。
      qc.invalidateQueries({ queryKey: ['session'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-2.5">
        {!hasPassword && <p className="text-[12.5px] text-fg-3">{t('settings.noPasswordYet')}</p>}
        {hasPassword && (
          <div>
            <span className={fieldLabel}>{t('settings.oldPassword')}</span>
            <Input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
        )}
        <div>
          <span className={fieldLabel}>{t('settings.newPassword')}</span>
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div>
          <span className={fieldLabel}>{t('settings.confirmPassword')}</span>
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        {error && <span className="text-[12px] text-danger">{error}</span>}
        {okMsg && !error && <span className="text-[12px] text-success">{okMsg}</span>}
        <div className="flex-1" />
        <Button
          variant="primary"
          size="md"
          onClick={submit}
          disabled={(hasPassword && !oldPassword) || !newPassword || !confirm || busy}
        >
          {t('settings.changePassword')}
        </Button>
      </div>
    </>
  );
}
