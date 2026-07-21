'use client';

import { Bookmark, SquareCheck, Bug } from 'lucide-react';
import { ISSUE_TYPE } from '@/lib/constants';
import type { IssueType } from '@/lib/types';

const GLYPH = { backlog: Bookmark, ticket: SquareCheck, bug: Bug } as const;

/* Issue 类型 glyph — backlog / ticket / bug, colored by type. A Bug is just an
   Issue whose type is bug, so it shares this same affordance everywhere an issue
   shows. */
export function TypeIcon({ type, size = 16 }: { type: IssueType; size?: number }) {
  const Icon = GLYPH[type];
  return <Icon size={size} style={{ color: ISSUE_TYPE[type].color, flex: 'none' }} />;
}
