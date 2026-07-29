'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProjectIcon } from '@/components/glyphs/misc';
import type { Project } from '@/lib/types';

/* 项目多选列表(check-circle 行)——Agent 接入令牌「项目白名单」与迭代弹窗
   「所属项目」共用。「全部选中 = 不限制」这类语义由调用方决定,不进组件。 */
export function ProjectCheckList({
  projects,
  selected,
  onToggle,
  maxH = 'max-h-40',
}: {
  projects: Pick<Project, 'id' | 'name' | 'icon' | 'color'>[];
  selected: string[];
  onToggle: (id: string) => void;
  maxH?: string;
}) {
  return (
    <div className={cn('overflow-hidden overflow-y-auto rounded-lg border border-border', maxH)}>
      {projects.map((p) => {
        const on = selected.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onToggle(p.id)}
            className="flex w-full items-center gap-2.5 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-surface-2/60"
          >
            <span
              className={cn(
                'grid h-4 w-4 flex-none place-items-center rounded-full border',
                on ? 'border-brand-blue bg-brand-blue text-white' : 'border-border-strong bg-surface',
              )}
            >
              {on && <Check size={11} strokeWidth={3} />}
            </span>
            <span className="grid h-4 w-4 flex-none place-items-center rounded" style={{ background: p.color }}>
              <ProjectIcon name={p.icon} size={11} />
            </span>
            <span className="min-w-0 truncate text-[13.5px] font-medium text-fg-1">{p.name}</span>
          </button>
        );
      })}
    </div>
  );
}
