import * as React from 'react';

/* Brand mark: 双箭迭代环（sprint iteration loop）— 敏捷研发。
   与 src/app/icon.svg 同一图形；渐变 id 用 useId 防止多实例冲突。 */
export function Logo({ size = 20, className }: { size?: number; className?: string }) {
  const gid = React.useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role="img"
      aria-label="AI Grego Track"
    >
      <defs>
        <linearGradient id={gid} x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366F1" />
          <stop offset="1" stopColor="#2563EB" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill={`url(#${gid})`} />
      {/* 下半弧：→ 左上箭头 */}
      <path
        d="M44.12 39A14 14 0 0 1 18.21 34.43"
        stroke="#fff"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M22.71 39.79L18.21 34.43L15.82 41.01"
        stroke="#fff"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 上半弧：→ 右下箭头 */}
      <path
        d="M19.88 25A14 14 0 0 1 45.79 29.57"
        stroke="#fff"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M41.29 24.21L45.79 29.57L48.18 22.99"
        stroke="#fff"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
