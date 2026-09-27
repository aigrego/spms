'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/* Detail drawer scaffolding — right slide-in panel + dim overlay + header row
   (left cluster / right action cluster / close button), shared by IssueDetail,
   RequirementDetail and TestCaseDetail.

   Escape-to-close is built in; IssueDetail passes closeOnEscape={false} because
   it needs a capture-phase handler that guards the lightbox / description-edit
   states. */
export function DetailDrawer({
  onClose,
  width = 760,
  header,
  headerActions,
  onPaste,
  closeOnEscape = true,
  children,
}: {
  onClose: () => void;
  /* Panel width cap in px; below that the panel takes 92vw. */
  width?: number;
  /* Left cluster of the header row (icon / id / badges). */
  header?: React.ReactNode;
  /* Right cluster, before the built-in close button. */
  headerActions?: React.ReactNode;
  onPaste?: React.ClipboardEventHandler<HTMLDivElement>;
  closeOnEscape?: boolean;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!closeOnEscape) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, closeOnEscape]);

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[800] animate-fadeIn bg-[rgba(11,18,32,0.35)]" />
      <div
        onPaste={onPaste}
        className="fixed inset-y-0 right-0 z-[810] flex animate-slideIn flex-col border-l border-border bg-surface shadow-4"
        style={{ width: `min(${width}px, 92vw)` }}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-border px-[18px] py-3">
          {header}
          <div className="flex-1" />
          {headerActions}
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="close">
            <X size={16} />
          </Button>
        </div>
        {children}
      </div>
    </>
  );
}
