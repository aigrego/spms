'use client';

import * as React from 'react';
import { Archive, ArchiveRestore, Pencil, Trash2 } from 'lucide-react';

/* Edit + archive + delete affordances shown on hover. Delete opens a
   type-to-confirm ConfirmDestructive (managed by the caller) — PMS-2 §6.10
   forbids one-click cascade deletes. Archive is reversible, so it's a plain
   button. Shared by the catalog and projects views. */
export function RowActions({
  onEdit,
  onDelete,
  onArchive,
  archived,
}: {
  onEdit: () => void;
  onDelete?: () => void;
  onArchive?: () => void;
  archived?: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={(ev) => {
          ev.stopPropagation();
          onEdit();
        }}
        className="hover-surface grid h-6 w-6 place-items-center rounded-md text-fg-3"
        aria-label="edit"
      >
        <Pencil size={13} />
      </button>
      {onArchive && (
        <button
          onClick={(ev) => {
            ev.stopPropagation();
            onArchive();
          }}
          className="hover-surface grid h-6 w-6 place-items-center rounded-md text-fg-3"
          aria-label={archived ? 'unarchive' : 'archive'}
        >
          {archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
        </button>
      )}
      {onDelete && (
        <button
          onClick={(ev) => {
            ev.stopPropagation();
            onDelete();
          }}
          className="hover-surface grid h-6 w-6 place-items-center rounded-md text-fg-3 hover:text-danger"
          aria-label="delete"
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}
