'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { useCascadeImpact } from '@/store/resources';
import type { AssignmentNodeType } from '@/lib/types';

/* PMS-2 §3.4 / §6.10 — type-to-confirm for downward cascades (lifecycle node
   deletes). The operator must type the entity's exact name, and the dialog lists
   the cascade impact (child nodes + resource assignments that vanish) so the blast
   radius is explicit before anything is removed. Replaces one-click delete. */

export function ConfirmDestructive({
  open,
  onOpenChange,
  name,
  node,
  chips: chipsProp,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  name: string;
  // when set, the dialog fetches + shows the cascade impact for this lifecycle node
  node?: { nodeType: AssignmentNodeType; nodeId: string };
  // pre-computed impact chips (e.g. a product line, which is not an assignment node)
  chips?: string[];
  busy?: boolean;
  onConfirm: () => void;
}) {
  const t = useT();
  const [typed, setTyped] = React.useState('');
  React.useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const { data: impact } = useCascadeImpact(node?.nodeType ?? 'project', node?.nodeId, !!node && !chipsProp && open);
  const serverChips: string[] = [];
  if (impact) {
    if (impact.descendants.release) serverChips.push(t('confirm.impactReleases', { n: impact.descendants.release }));
    if (impact.descendants.project) serverChips.push(t('confirm.impactProjects', { n: impact.descendants.project }));
    if (impact.descendants.sprint) serverChips.push(t('confirm.impactSprints', { n: impact.descendants.sprint }));
    if (impact.assignments) serverChips.push(t('confirm.impactAssignments', { n: impact.assignments }));
  }
  const chips = chipsProp ?? serverChips;
  const hasImpactSource = !!node || !!chipsProp;

  const armed = typed.trim() === name.trim() && !busy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="w-[min(460px,92vw)]">
        <div className="flex items-start gap-3 px-[18px] pb-1 pt-[18px]">
          <span
            className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-full"
            style={{ background: 'var(--danger-50)', color: 'var(--danger-500)' }}
          >
            <AlertTriangle size={17} />
          </span>
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-[15px] font-semibold text-fg-1">
              {t('confirm.deleteTitle', { name })}
            </DialogPrimitive.Title>
            <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">{t('confirm.cascadeWarn')}</p>
          </div>
        </div>

        <div className="px-[18px] py-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
            {t('confirm.impact')}
          </div>
          {!hasImpactSource || chips.length === 0 ? (
            <div className="text-[12.5px] text-fg-3">{t('confirm.nothing')}</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium"
                  style={{ background: 'var(--danger-50)', color: '#8C1B28' }}
                >
                  {c}
                </span>
              ))}
            </div>
          )}

          <label className="mt-3.5 block text-[12px] text-fg-2">
            {t('confirm.typeToConfirm', { name })}
          </label>
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && armed && onConfirm()}
            className="mt-1.5 h-9 w-full rounded-lg border border-border-strong bg-surface px-2.5 font-mono text-[13px] text-fg-1 outline-none focus:border-danger"
            placeholder={name}
          />
        </div>

        <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
          <div className="flex-1" />
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" size="md" onClick={onConfirm} disabled={!armed}>
            {t('confirm.delete')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
