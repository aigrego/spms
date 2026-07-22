'use client';

import { Sparkles, Users } from 'lucide-react';
import type { Member } from '@/lib/types';

export function Avatar({
  person,
  size = 22,
  ring,
}: {
  person?: Member | null;
  size?: number;
  ring?: boolean;
}) {
  if (!person) {
    return (
      <span
        className="grid place-items-center rounded-full text-fg-3"
        style={{
          width: size,
          height: size,
          border: '1.5px dashed var(--border-strong)',
          flex: 'none',
        }}
      >
        <Users size={size * 0.55} />
      </span>
    );
  }

  const isAgent = person.type === 'agent';
  const showImage = !isAgent && !!person.avatarUrl;
  return (
    <span
      title={person.name}
      className="relative grid place-items-center overflow-hidden rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        flex: 'none',
        fontSize: size * 0.42,
        background: isAgent ? 'var(--ink)' : person.color ?? 'var(--slate-500)',
        boxShadow:
          isAgent || ring
            ? `0 0 0 1.5px var(--surface), 0 0 0 3px ${isAgent ? 'var(--brand-orange)' : 'var(--brand-blue)'}`
            : 'none',
      }}
    >
      {isAgent ? (
        <Sparkles size={size * 0.56} color="var(--brand-orange)" />
      ) : showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- 外部 OAuth 头像，域名不固定，不适用 next/image
        <img src={person.avatarUrl!} alt={person.name} width={size} height={size} className="h-full w-full object-cover" />
      ) : (
        person.initials
      )}
    </span>
  );
}
