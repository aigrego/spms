'use client';

import * as React from 'react';

/* settings 区域的通用卡片与设置行(SettingsClient / NotionCard /
   PreferencesPanel / StorageInfoCard 共用)。 */

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[14px] border border-border bg-surface px-6 py-5 shadow-1">
      <h2 className="mb-2 text-[15px] font-semibold text-fg-1">{title}</h2>
      {children}
    </section>
  );
}

export function Row({ label, desc, control }: { label: string; desc?: string; control: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-b border-border py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium text-fg-1">{label}</div>
        {desc && <div className="mt-0.5 text-[12px] text-fg-3">{desc}</div>}
      </div>
      {control}
    </div>
  );
}
