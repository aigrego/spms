import * as React from 'react';

/* 登录页左侧宣传插画：抽象的产品界面（看板 + 路线图 + 进度）线稿。
   纯 SVG、无依赖，配色跟随品牌蓝，在深色面板上以白色半透明描边呈现。 */
export function LoginArtwork({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 520 400" fill="none" className={className} role="img" aria-label="产品插画">
      {/* 背景装饰圆 */}
      <circle cx="430" cy="60" r="90" stroke="white" strokeOpacity="0.12" strokeWidth="1.5" />
      <circle cx="430" cy="60" r="58" stroke="white" strokeOpacity="0.18" strokeWidth="1.5" strokeDasharray="4 6" />
      <circle cx="70" cy="330" r="70" stroke="white" strokeOpacity="0.1" strokeWidth="1.5" />

      {/* 主窗口 */}
      <g filter="url(#login-art-shadow)">
        <rect x="90" y="70" width="340" height="240" rx="14" fill="white" />
      </g>
      {/* 窗口标题栏 */}
      <circle cx="110" cy="90" r="4" fill="#FF5F57" />
      <circle cx="124" cy="90" r="4" fill="#FEBC2E" />
      <circle cx="138" cy="90" r="4" fill="#28C840" />
      <rect x="300" y="84" width="112" height="12" rx="6" fill="#EEF2FB" />
      <line x1="90" y1="106" x2="430" y2="106" stroke="#E8ECF4" strokeWidth="1.5" />

      {/* 侧边栏 */}
      <rect x="102" y="118" width="64" height="10" rx="5" fill="#3370FF" fillOpacity="0.85" />
      <rect x="102" y="140" width="52" height="8" rx="4" fill="#E3EAF9" />
      <rect x="102" y="158" width="58" height="8" rx="4" fill="#E3EAF9" />
      <rect x="102" y="176" width="46" height="8" rx="4" fill="#E3EAF9" />
      <rect x="102" y="194" width="54" height="8" rx="4" fill="#E3EAF9" />
      <circle cx="107" cy="292" r="7" fill="#3370FF" />
      <circle cx="123" cy="292" r="7" fill="#FF7D00" />
      <circle cx="139" cy="292" r="7" fill="#14C0FF" />

      {/* 看板列 1 */}
      <rect x="182" y="120" width="72" height="176" rx="8" fill="#F5F7FC" />
      <circle cx="192" cy="134" r="3" fill="#3370FF" />
      <rect x="200" y="130" width="34" height="8" rx="4" fill="#C6D6F8" />
      <rect x="190" y="148" width="56" height="40" rx="6" fill="white" stroke="#E3E9F5" />
      <rect x="197" y="157" width="36" height="6" rx="3" fill="#D8E1F2" />
      <rect x="197" y="169" width="26" height="6" rx="3" fill="#E8EEF8" />
      <rect x="190" y="196" width="56" height="40" rx="6" fill="white" stroke="#E3E9F5" />
      <rect x="197" y="205" width="30" height="6" rx="3" fill="#D8E1F2" />
      <rect x="197" y="217" width="36" height="6" rx="3" fill="#E8EEF8" />

      {/* 看板列 2 */}
      <rect x="264" y="120" width="72" height="176" rx="8" fill="#F5F7FC" />
      <circle cx="274" cy="134" r="3" fill="#FF7D00" />
      <rect x="282" y="130" width="34" height="8" rx="4" fill="#FADFC3" />
      <rect x="272" y="148" width="56" height="52" rx="6" fill="white" stroke="#E3E9F5" />
      <rect x="279" y="157" width="38" height="6" rx="3" fill="#D8E1F2" />
      <rect x="279" y="169" width="28" height="6" rx="3" fill="#E8EEF8" />
      <rect x="279" y="184" width="42" height="6" rx="3" fill="#3370FF" fillOpacity="0.55" />
      <rect x="272" y="208" width="56" height="40" rx="6" fill="white" stroke="#E3E9F5" />
      <rect x="279" y="217" width="34" height="6" rx="3" fill="#D8E1F2" />
      <rect x="279" y="229" width="24" height="6" rx="3" fill="#E8EEF8" />

      {/* 看板列 3 */}
      <rect x="346" y="120" width="72" height="176" rx="8" fill="#F5F7FC" />
      <circle cx="356" cy="134" r="3" fill="#28C840" />
      <rect x="364" y="130" width="34" height="8" rx="4" fill="#C4EDD0" />
      <rect x="354" y="148" width="56" height="40" rx="6" fill="white" stroke="#E3E9F5" />
      <rect x="361" y="157" width="34" height="6" rx="3" fill="#D8E1F2" />
      <rect x="361" y="169" width="26" height="6" rx="3" fill="#E8EEF8" />

      {/* 浮动卡片：迭代进度 */}
      <g filter="url(#login-art-shadow)">
        <rect x="330" y="262" width="150" height="92" rx="12" fill="white" />
      </g>
      <circle cx="362" cy="296" r="16" stroke="#E3EAF9" strokeWidth="5" />
      <path d="M362 280 a16 16 0 0 1 13.9 24" stroke="#3370FF" strokeWidth="5" strokeLinecap="round" />
      <rect x="388" y="284" width="68" height="8" rx="4" fill="#DCE5F6" />
      <rect x="388" y="300" width="48" height="7" rx="3.5" fill="#E8EEF8" />
      <rect x="342" y="330" width="126" height="8" rx="4" fill="#EDF1FA" />
      <rect x="342" y="330" width="84" height="8" rx="4" fill="#3370FF" />

      {/* 浮动卡片：路线图 */}
      <g filter="url(#login-art-shadow)">
        <rect x="36" y="150" width="118" height="86" rx="12" fill="white" />
      </g>
      <polyline points="48,214 70,196 90,204 112,180 142,170" stroke="#3370FF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="112" cy="180" r="4" fill="#3370FF" />
      <rect x="48" y="162" width="52" height="8" rx="4" fill="#DCE5F6" />
      <rect x="48" y="222" width="80" height="1.5" fill="#E8EEF8" />

      {/* 漂浮装饰 */}
      <circle cx="466" cy="238" r="5" fill="white" fillOpacity="0.5" />
      <circle cx="52" cy="96" r="4" fill="white" fillOpacity="0.4" />
      <rect x="452" y="130" width="10" height="10" rx="2" fill="white" fillOpacity="0.35" transform="rotate(18 457 135)" />

      <defs>
        <filter id="login-art-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="8" stdDeviation="12" floodColor="#0B1E4B" floodOpacity="0.18" />
        </filter>
      </defs>
    </svg>
  );
}

/* 飞书品牌标识（简化鸟形）。 */
export function FeishuMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M13.2 3.5c3.5 0 6.3 2.7 6.3 6.2 0 .4 0 .8-.1 1.2l3.1 2.6c.3.2.1.7-.3.7h-2.7c-1.1 2-3.2 3.3-5.7 3.3-3.5 0-6.3-2.8-6.3-6.2 0-.4 0-.8.1-1.2L4.4 7.5c-.3-.2-.1-.7.3-.7h2.7c1.1-2 3.3-3.3 5.8-3.3Z"
        fill="#3370FF"
      />
      <circle cx="15.8" cy="9.2" r="1.4" fill="white" />
    </svg>
  );
}

/* Lark（国际版）品牌标识 — 与飞书同形，渐变配色。 */
export function LarkMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <defs>
        <linearGradient id="lark-mark-g" x1="4" y1="3" x2="22" y2="18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#14C0FF" />
          <stop offset="1" stopColor="#3370FF" />
        </linearGradient>
      </defs>
      <path
        d="M13.2 3.5c3.5 0 6.3 2.7 6.3 6.2 0 .4 0 .8-.1 1.2l3.1 2.6c.3.2.1.7-.3.7h-2.7c-1.1 2-3.2 3.3-5.7 3.3-3.5 0-6.3-2.8-6.3-6.2 0-.4 0-.8.1-1.2L4.4 7.5c-.3-.2-.1-.7.3-.7h2.7c1.1-2 3.3-3.3 5.8-3.3Z"
        fill="url(#lark-mark-g)"
      />
      <circle cx="15.8" cy="9.2" r="1.4" fill="white" />
    </svg>
  );
}
