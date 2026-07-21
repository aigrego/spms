'use client';

import * as React from 'react';
import { Plus } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/* Reusable inline primitives (PMS-3 §5). Linear-style quick edit/insert so big
   lists stay fast: add a row without a modal, rename a title in place. */

/* A "+ Add" affordance that expands into a title input. Enter creates and keeps
   the input open + cleared for rapid multi-add; Escape / empty-blur collapses. */
export function InlineCreateRow({
  label,
  placeholder,
  onCreate,
  className,
}: {
  label: string;
  placeholder?: string;
  onCreate: (title: string) => void;
  className?: string;
}) {
  const t = useT();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState('');

  const submit = () => {
    const v = value.trim();
    if (!v) {
      setEditing(false);
      return;
    }
    onCreate(v);
    setValue(''); // keep editing for rapid multi-add
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={cn(
          'flex w-full items-center gap-2 px-5 py-2 text-left text-[13px] font-medium text-fg-3 transition-colors hover:bg-surface-2 hover:text-brand-blue',
          className,
        )}
      >
        <Plus size={14} /> {label}
      </button>
    );
  }
  return (
    <div className={cn('flex items-center gap-2 px-5 py-1.5', className)}>
      <Plus size={14} className="flex-none text-brand-blue" />
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            setValue('');
            setEditing(false);
          }
        }}
        onBlur={() => {
          if (!value.trim()) setEditing(false);
        }}
        placeholder={placeholder ?? t('inline.titlePlaceholder')}
        className="w-full bg-transparent text-[13px] text-fg-1 outline-none placeholder:text-fg-3"
      />
    </div>
  );
}

/* Inline-editable text (titles). Click → input; Enter / blur saves; Escape reverts.
   stopPropagation so editing doesn't trigger the row's own click (open drawer). */
export function EditableTitle({
  value,
  onSave,
  className,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== value) onSave(v);
    else setDraft(value);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
        className={cn(
          'min-w-0 flex-1 rounded border border-brand-blue bg-surface px-1 py-px text-fg-1 outline-none',
          className,
        )}
      />
    );
  }
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      className={cn('cursor-text truncate rounded px-1 py-px hover:bg-surface-2', className)}
    >
      {value}
    </span>
  );
}
