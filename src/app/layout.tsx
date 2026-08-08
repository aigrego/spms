import type { Metadata } from 'next';
import { Space_Grotesk, JetBrains_Mono, Iceland } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
});

const iceland = Iceland({
  variable: '--font-iceland',
  weight: '400',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'AI Grego Track',
  description: '研发工作区',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      data-theme="light"
      // 内联脚本会在水合前按用户偏好改写 data-theme —— 告知 React 以 DOM 为准，
      // 否则属性失配触发水合恢复（整树客户端重建），进而报 script 警告。
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} ${iceland.variable} h-full antialiased`}
    >
      <head>
        {/* Anti-flash theme bootstrap: resolve the persisted preference
            ('light' | 'dark' | 'system', default light) before first paint.
            Kept in sync with src/lib/theme.ts. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('theme');var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}",
          }}
        />
      </head>
      <body className="h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
