'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { UserPlus } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { useInviteResource } from '@/store/resources';
import { ApiError } from '@/lib/api';
import type { Member } from '@/lib/types';

const fieldLabel = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-3';
const inputCls =
  'h-9 w-full rounded-lg border border-border-strong bg-surface px-2.5 text-[13px] text-fg-1 outline-none focus:border-brand-blue';

/* Invite an external resource into the pool (PMS-2 §5.1). Shared by the resource
   pool page and the per-node assigner. Standalone rewrite: the blueprint's
   portalUserId/homeTenantId collapse into a single local `userId` field — the
   rewritten server service requires at least one of email / userId. */
export function InviteResourceModal({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onInvited?: (m: Member) => void;
}) {
  const t = useT();
  const invite = useInviteResource();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [userId, setUserId] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName('');
      setEmail('');
      setPhone('');
      setUserId('');
      setError(null);
    }
  }, [open]);

  const canSubmit = (email.trim() || phone.trim() || userId.trim()) && !invite.isPending;

  const submit = async () => {
    setError(null);
    try {
      const m = await invite.mutateAsync({
        name: name.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        userId: userId.trim() || undefined,
      });
      onInvited?.(m);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="w-[min(440px,92vw)]">
        <div className="flex items-center gap-2.5 px-[18px] pb-1 pt-4">
          <span
            className="grid h-7 w-7 flex-none place-items-center rounded-lg"
            style={{ background: 'var(--brand-blue-tint-8)', color: 'var(--brand-blue)' }}
          >
            <UserPlus size={15} />
          </span>
          <DialogPrimitive.Title className="text-[15px] font-semibold text-fg-1">
            {t('invite.title')}
          </DialogPrimitive.Title>
        </div>
        <div className="flex flex-col gap-3 px-[18px] py-3">
          <div>
            <span className={fieldLabel}>{t('invite.name')}</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('invite.namePlaceholder')} className={inputCls} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <span className={fieldLabel}>{t('invite.email')}</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('invite.emailPlaceholder')} className={inputCls} />
            </div>
            <div className="flex-1">
              <span className={fieldLabel}>{t('invite.phone')}</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('invite.phonePlaceholder')} className={inputCls} />
            </div>
          </div>
          <div>
            <span className={fieldLabel}>{t('invite.userId')}</span>
            <input value={userId} onChange={(e) => setUserId(e.target.value)} className={inputCls} />
          </div>
          <p className="text-[11.5px] leading-relaxed text-fg-3">{t('invite.hint')}</p>
          {error && (
            <p className="rounded-md px-2.5 py-1.5 text-[12px]" style={{ background: 'var(--danger-50)', color: '#8C1B28' }}>
              {error}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
          <div className="flex-1" />
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            {t('invite.submit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
