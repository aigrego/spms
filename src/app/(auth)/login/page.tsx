'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Logo } from '@/components/Logo';
import { FeishuMark, LarkMark, LoginArtwork } from '@/components/LoginArtwork';
import { authApi, ApiError, type OAuthEntry } from '@/lib/api';
import { useT } from '@/lib/i18n';

export default function LoginPage() {
  const qc = useQueryClient();
  const t = useT();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  // OAuth 回调失败时跳到 /login?error=<provider>，在此透出提示（lazy init —
  // SSR 时无 window，首次客户端渲染读取；误差仅影响错误条的 hydration）。
  const [error, setError] = React.useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const p = new URLSearchParams(window.location.search).get('error');
    if (p === 'feishu') return '飞书登录失败，请重试';
    if (p === 'lark') return 'Lark 登录失败，请重试';
    return null;
  });
  const [busy, setBusy] = React.useState(false);
  const [oauth, setOauth] = React.useState<{ feishu: OAuthEntry; lark: OAuthEntry } | null>(null);

  // 第三方登录入口仅在对应服务端已配置时展示；未配置 / 接口失败都隐藏按钮。
  React.useEffect(() => {
    let alive = true;
    authApi.oauthConfig().then((cfg) => {
      if (alive && cfg) setOauth(cfg);
    });
    return () => {
      alive = false;
    };
  }, []);

  // OAuth 回调失败时跳到 /login?error=<provider>（见 error 的 lazy init）。

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.login(username.trim(), password);
      // The session cookie is now set — drop any cached pre-login query state
      // (bootstrap 401 etc.) and enter the app. Full navigation guarantees the
      // (app) tree mounts fresh with the new cookie (SPA 跳转在 dev 下偶发
      // Suspense 不 resolve，整页跳转最稳).
      qc.clear();
      window.location.href = '/issues';
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-bg">
      {/* 左侧宣传区（移动端隐藏） */}
      <aside className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-brand-blue p-12 lg:flex">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'linear-gradient(160deg, rgba(20,192,255,0.25), transparent 55%), linear-gradient(20deg, rgba(11,30,75,0.45), transparent 60%)' }}
        />
        <div className="relative flex items-center gap-2.5 text-white">
          <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-white/15">
            <Logo size={22} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">{t('app.title')}</span>
        </div>

        <div className="relative mt-10">
          <h2 className="m-0 text-[30px] font-semibold leading-snug tracking-tight text-white">
            产品线 → 产品 → 版本
            <br />
            一站式研发生命周期管理
          </h2>
          <p className="mt-3 max-w-[420px] text-[14px] leading-relaxed text-white/75">
            Issue、迭代、需求、测试用例与研发资源统一规划，让团队交付节奏一目了然。
          </p>
        </div>

        <LoginArtwork className="relative mx-auto w-full max-w-[520px]" />

        <p className="relative m-0 text-[12px] text-white/50">{t('app.workspace')}</p>
      </aside>

      {/* 右侧登录表单 */}
      <main className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-[360px]">
          <div className="mb-3 flex justify-center lg:hidden">
            <Logo size={44} />
          </div>
          <h1 className="m-0 text-center text-[22px] font-semibold tracking-tight text-fg-1 lg:text-left">
            欢迎回来
          </h1>
          <p className="mb-6 mt-1.5 text-center text-[12.5px] text-fg-3 lg:text-left">
            登录 {t('app.title')}，继续你的研发协作
          </p>

          <form onSubmit={submit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-fg-2">用户名</span>
              <Input
                autoFocus
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-fg-2">密码</span>
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </label>
            {error && (
              <div suppressHydrationWarning className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-50)', color: '#8C1B28' }}>
                {error}
              </div>
            )}
            <Button type="submit" variant="primary" size="lg" disabled={!username.trim() || !password || busy}>
              {busy ? '登录中…' : '登录'}
            </Button>
          </form>

          {oauth && (
            <>
              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[11px] text-fg-3">或使用以下方式登录</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="flex flex-col gap-2.5">
                {oauth.feishu && (
                  <Button
                    variant="secondary"
                    size="lg"
                    className="w-full"
                    onClick={() => {
                      window.location.href = oauth.feishu?.url ?? '/api/auth/feishu/login';
                    }}
                  >
                    <FeishuMark size={16} /> 飞书登录
                  </Button>
                )}
                {oauth.lark && (
                  <Button
                    variant="secondary"
                    size="lg"
                    className="w-full"
                    onClick={() => {
                      window.location.href = oauth.lark?.url ?? '/api/auth/lark/login';
                    }}
                  >
                    <LarkMark size={16} /> Lark 登录
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
