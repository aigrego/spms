'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, authApi } from '@/lib/api';
import { useT } from '@/lib/i18n';

/* 邮箱管理(基本资料页):列出主/备邮箱,支持添加备用、设为主、删除备用。
   数据来自 /api/auth/emails(user_emails);主邮箱同步进 session.user.email,
   变更后失效 ['session'] 让顶栏/会话拿到最新值。 */
export function EmailsCard() {
  const t = useT();
  const qc = useQueryClient();
  const [newEmail, setNewEmail] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const { data: emails } = useQuery({ queryKey: ['emails'], queryFn: authApi.listEmails });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['emails'] });
    qc.invalidateQueries({ queryKey: ['session'] });
  };
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : String(e));

  const add = useMutation({
    mutationFn: (email: string) => authApi.addEmail(email),
    onSuccess: () => {
      setNewEmail('');
      setError(null);
      invalidate();
    },
    onError,
  });
  const setPrimary = useMutation({
    mutationFn: (email: string) => authApi.setPrimaryEmail(email),
    onSuccess: invalidate,
    onError,
  });
  const remove = useMutation({
    mutationFn: (email: string) => authApi.removeEmail(email),
    onSuccess: invalidate,
    onError,
  });

  const busy = add.isPending || setPrimary.isPending || remove.isPending;

  return (
    <div>
      <div className="flex flex-col gap-2">
        {(emails ?? []).map((e) => (
          <div key={e.email} className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2">
            <Mail size={14} className="flex-none text-fg-3" />
            <span className="truncate text-[13px] text-fg-1">{e.email}</span>
            {e.isPrimary && <Badge tone="blue">{t('profile.emailPrimary')}</Badge>}
            {e.verified && <Badge tone="neutral">{t('profile.emailVerified')}</Badge>}
            <div className="flex-1" />
            {!e.isPrimary && (
              <>
                <button
                  className="text-[12px] font-medium text-brand-blue hover:underline disabled:opacity-40"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setPrimary.mutate(e.email);
                  }}
                >
                  {t('profile.emailSetPrimary')}
                </button>
                <button
                  className="text-fg-3 hover:text-danger disabled:opacity-40"
                  disabled={busy}
                  title={t('profile.emailDelete')}
                  onClick={() => {
                    setError(null);
                    remove.mutate(e.email);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        ))}
        {emails && emails.length === 0 && (
          <div className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-[12.5px] text-fg-3">
            {t('profile.emailEmpty')}
          </div>
        )}
      </div>
      <div className="mt-2.5 flex gap-2">
        <Input
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder={t('invite.emailPlaceholder')}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' && newEmail.trim() && !busy) add.mutate(newEmail.trim());
          }}
        />
        <Button
          variant="secondary"
          size="md"
          disabled={!newEmail.trim() || busy}
          onClick={() => {
            setError(null);
            add.mutate(newEmail.trim());
          }}
        >
          <Plus size={14} />
          {t('profile.emailAdd')}
        </Button>
      </div>
      {error && <div className="mt-1.5 text-[12px] text-danger">{error}</div>}
      <div className="mt-1.5 text-[12px] text-fg-3">{t('profile.emailHint')}</div>
    </div>
  );
}
