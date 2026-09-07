'use client';

import * as React from 'react';
import { Filter } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent, MenuItem } from '@/components/ui/popover';
import { ProjectIcon } from '@/components/glyphs/misc';
import { usePersistentState } from '@/lib/prefs';
import { useAppData } from '@/store/AppData';
import { useT } from '@/lib/i18n';

const isStr = (v: unknown): v is string => typeof v === 'string';

/* 「全部 Issues」页面的项目筛选,供 Issues/需求池/测试用例三个页面工具栏
   与侧边栏快捷筛选共用:'all' 为全部项目的哨兵值,浏览器记忆 key
   'issues.projectFilter',同 tab 内经 usePersistentState 的 emitter 即时互相同步。 */
export function useProjectFilter() {
  return usePersistentState<string>('issues.projectFilter', 'all', isStr);
}

export function ProjectFilterMenu() {
  const t = useT();
  const { projects, projectById } = useAppData();
  const [projectFilter, setProjectFilter] = useProjectFilter();
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[13px] text-fg-2 hover:bg-surface-2">
          <Filter size={14} /> {t('issues.filter')}
          {projectFilter !== 'all' && (projectById(projectFilter)?.name ?? projectFilter)}
        </button>
      </PopoverTrigger>
      <PopoverContent style={{ width: 200 }} align="start">
        <MenuItem
          label={t('common.all')}
          selected={projectFilter === 'all'}
          onClick={() => {
            setProjectFilter('all');
            setOpen(false);
          }}
        />
        {projects.map((p) => (
          <MenuItem
            key={p.id}
            glyph={
              <span
                className="grid h-4 w-4 flex-none place-items-center rounded"
                style={{ background: p.color }}
              >
                <ProjectIcon name={p.icon} size={11} />
              </span>
            }
            label={p.name}
            selected={projectFilter === p.id}
            onClick={() => {
              setProjectFilter(p.id);
              setOpen(false);
            }}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}
