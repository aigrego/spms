'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/glyphs/Avatar';
import { ProjectIcon } from '@/components/glyphs/misc';
import { ViewHeader } from '@/components/ScrumViews';
import { useT } from '@/lib/i18n';
import { useAppData } from '@/store/AppData';

/* Roadmap — 1:1 port of spms-app's RoadmapView (OtherViews.tsx).
   TODO(data): the lane layout (start/span per project) and the month scale are
   hardcoded placeholders, exactly as in the blueprint — derive lanes from
   project target dates / release targetDate once the roadmap API exists. */
export default function RoadmapPage() {
  const t = useT();
  const router = useRouter();
  const { projects, memberById } = useAppData();
  const months = [t('roadmap.m5'), t('roadmap.m6'), t('roadmap.m7'), t('roadmap.m8'), t('roadmap.q3')];
  // TODO(data): hardcoded lane placement (project index → grid offset/span)
  const lanes = [
    { i: 0, start: 0, span: 2 },
    { i: 3, start: 0, span: 3 },
    { i: 1, start: 1, span: 2 },
    { i: 2, start: 2, span: 2 },
    { i: 4, start: 3, span: 2 },
    { i: 5, start: 1, span: 3 },
  ];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ViewHeader title={t('roadmap.title')}>
        <Badge tone="neutral">{t('roadmap.half')}</Badge>
      </ViewHeader>
      <div className="flex-1 overflow-auto p-6">
        <div style={{ minWidth: 760 }}>
          <div
            className="mb-2 grid border-b border-border pb-2"
            style={{ gridTemplateColumns: '200px repeat(5, 1fr)' }}
          >
            <div />
            {months.map((m, i) => (
              <div
                key={m}
                className="relative text-center text-[12.5px] font-semibold"
                style={{ color: i === 1 ? 'var(--brand-blue)' : 'var(--fg-3)' }}
              >
                {m}
                {i === 1 && (
                  <span className="absolute left-1/2 top-[22px] -translate-x-1/2 text-[9.5px] font-medium text-brand-blue">
                    {t('roadmap.today')}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="relative flex flex-col gap-1.5">
            <div
              className="absolute bottom-0 top-0 z-0 w-0.5 bg-brand-blue opacity-25"
              style={{ left: `calc(200px + (100% - 200px) / 5 * 1.5)` }}
            />
            {lanes.map((lane) => {
              const p = projects[lane.i];
              if (!p) return null;
              const aiLead = memberById(p.aiLeadId);
              return (
                <div
                  key={lane.i}
                  className="relative z-[1] grid h-[46px] items-center"
                  style={{ gridTemplateColumns: '200px repeat(5, 1fr)' }}
                >
                  <div className="flex items-center gap-2.5 pr-3">
                    <span
                      className="grid h-6 w-6 flex-none place-items-center rounded-[7px]"
                      style={{ background: p.color }}
                    >
                      <ProjectIcon name={p.icon} size={13} />
                    </span>
                    <span className="truncate text-[13px] font-medium text-fg-1">{p.name}</span>
                  </div>
                  <div
                    className="px-[3px]"
                    style={{ gridColumn: `${lane.start + 2} / span ${lane.span}` }}
                  >
                    <div
                      onClick={() => router.push(`/projects/${p.id}`)}
                      className="lift-card relative flex h-[30px] cursor-pointer items-center gap-2 overflow-hidden rounded-lg px-2.5"
                      style={{ background: p.color }}
                    >
                      <div
                        className="absolute inset-0 left-auto right-0"
                        style={{ background: 'rgba(255,255,255,0.78)', width: `${100 - p.progress * 100}%` }}
                      />
                      <span className="relative z-[1] text-[11.5px] font-semibold text-white">
                        {Math.round(p.progress * 100)}%
                      </span>
                      {aiLead && (
                        <span className="relative z-[1]">
                          <Avatar person={aiLead} size={18} />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
