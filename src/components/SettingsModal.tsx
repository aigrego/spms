'use client';

import * as React from 'react';
import { Settings } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useAppData } from '@/store/AppData';
import { ApiError, authApi } from '@/lib/api';
import { useT } from '@/lib/i18n';

const fieldLabel = 'mb-1 block text-[12px] font-medium text-fg-2';

function ProfileRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-[72px] flex-none text-[12.5px] text-fg-3">{label}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-fg-1">{children}</span>
    </div>
  );
}

/* Password form holds its own state and lives inside DialogContent, which
   Radix unmounts on close — so the form resets naturally on every open. */
function ChangePasswordForm() {
  const t = useT();
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
      await authApi.changePassword(oldPassword, newPassword);
      setOkMsg(t('settings.passwordChanged'));
      setOldPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
          {t('settings.password')}
        </div>
        <div className="flex flex-col gap-2.5">
          <div>
            <span className={fieldLabel}>{t('settings.oldPassword')}</span>
            <Input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
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
      </div>
      <div className="flex items-center gap-2">
        {error && <span className="text-[12px] text-danger">{error}</span>}
        {okMsg && !error && <span className="text-[12px] text-success">{okMsg}</span>}
        <div className="flex-1" />
        <Button
          variant="primary"
          size="md"
          onClick={submit}
          disabled={!oldPassword || !newPassword || !confirm || busy}
        >
          {t('settings.changePassword')}
        </Button>
      </div>
    </>
  );
}

/* Account settings: read-only profile (from the sandbox session) + change
   password form. Opened from the header user menu. */
export function SettingsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useT();
  const { session, currentCompany, companyRole } = useAppData();

  const role = companyRole ? t(`role.${companyRole}`) : '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ width: 'min(480px, 92vw)' }}>
        <div className="flex items-center gap-2.5 px-[18px] pb-1 pt-4">
          <span
            className="grid h-7 w-7 place-items-center rounded-lg"
            style={{ background: 'var(--brand-blue-tint-8)', color: 'var(--brand-blue)' }}
          >
            <Settings size={15} />
          </span>
          <DialogPrimitive.Title className="text-[15px] font-semibold text-fg-1">
            {t('settings.title')}
          </DialogPrimitive.Title>
        </div>

        <div className="flex flex-col gap-4 px-[18px] py-3">
          {/* Profile (read-only) */}
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
              {t('settings.profile')}
            </div>
            <div className="rounded-lg border border-border bg-surface-2 px-3 py-1.5">
              <ProfileRow label={t('settings.username')}>{session?.user.username ?? '—'}</ProfileRow>
              <ProfileRow label={t('settings.name')}>{session?.user.name ?? '—'}</ProfileRow>
              <ProfileRow label={t('settings.company')}>
                {currentCompany ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 flex-none rounded-full"
                      style={{ background: currentCompany.color || 'var(--slate-500)' }}
                    />
                    {currentCompany.name}
                  </span>
                ) : (
                  '—'
                )}
              </ProfileRow>
              <ProfileRow label={t('settings.role')}>
                {companyRole ? <Badge tone="blue">{role}</Badge> : '—'}
              </ProfileRow>
            </div>
          </div>

          {/* Change password */}
          <ChangePasswordForm />
        </div>

        <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
          <div className="flex-1" />
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
