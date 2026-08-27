'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { GUIDE } from '@/lib/i18n/guide';
import { useLocale } from '@/lib/i18n';

/* /guide — 生命周期指引(TKT-68)。静态文档页:内容按 locale 存于
   src/lib/i18n/guide.ts(长文案不进 t() 词典),这里只负责版式。
   垂直时间轴:圆圈字母徽章 + 连接线,每步标注 人工/AI Agent 与负责人。 */
export default function GuidePage() {
  const locale = useLocale();
  const g = GUIDE[locale] ?? GUIDE['zh-CN'];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[760px] px-6 py-10">
        <h1 className="m-0 text-[24px] font-semibold tracking-tight text-fg-1">{g.title}</h1>
        <p className="mb-10 mt-2 text-[13.5px] leading-relaxed text-fg-3">{g.subtitle}</p>

        <div>
          {g.steps.map((s, i) => (
            <div key={s.letter} className="flex gap-4">
              {/* timeline rail: circled letter + connector */}
              <div className="flex flex-col items-center">
                <span className="grid h-7 w-7 flex-none place-items-center rounded-full border border-border bg-surface text-[12px] font-semibold text-brand-blue">
                  {s.letter}
                </span>
                {i < g.steps.length - 1 && <span className="my-1 w-px flex-1 bg-border" />}
              </div>

              <div className="min-w-0 flex-1 pb-8">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="m-0 text-[15px] font-semibold text-fg-1">{s.title}</h2>
                  {s.badges.map((b) => (
                    <Badge key={b} tone={b === 'agent' ? 'blue' : 'neutral'}>
                      {b === 'agent' ? g.badgeAgent : g.badgeHuman}
                    </Badge>
                  ))}
                </div>
                <div className="mt-1 text-[12px] text-fg-3">{s.owner}</div>
                {s.body.map((p, k) => (
                  <p key={k} className="mb-0 mt-2.5 text-[13.5px] leading-relaxed text-fg-2">
                    {p}
                  </p>
                ))}
                {s.codes?.map((c) => (
                  <div
                    key={c}
                    className="mt-2.5 overflow-x-auto rounded-[8px] border border-border bg-surface-sunken px-3 py-2 font-mono text-[12px] text-fg-1"
                  >
                    {c}
                  </div>
                ))}
                {s.link && (
                  <Link
                    href={s.link.href}
                    className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-brand-blue hover:underline"
                  >
                    {s.link.label} <ArrowRight size={13} />
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-2 flex items-start gap-2.5 rounded-[10px] border border-border bg-surface-2 px-3.5 py-3">
          <Info size={15} className="mt-px flex-none text-fg-3" />
          <p className="m-0 text-[12.5px] leading-relaxed text-fg-2">{g.footer}</p>
        </div>
      </div>
    </div>
  );
}
