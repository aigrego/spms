'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ScanQrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authApi, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';

export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const t = useT();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [lark, setLark] = React.useState<{ configured: boolean; url?: string } | null>(null);

  // 飞书扫码登录入口仅在服务端已配置时展示（配置接口由 Phase B2 提供；
  // 未配置 / 接口不存在 / 请求失败都隐藏按钮）。
  React.useEffect(() => {
    let alive = true;
    authApi.larkConfig().then((cfg) => {
      if (alive) setLark(cfg);
    });
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.login(username.trim(), password);
      // The session cookie is now set — drop any cached pre-login query state
      // (bootstrap 401 etc.) and enter the app.
      qc.clear();
      router.replace('/issues');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-bg px-6">
      <div className="w-full max-w-[360px] rounded-xl border border-border bg-surface p-6 shadow-3">
        <h1 className="m-0 text-center text-[19px] font-semibold tracking-tight text-fg-1">
          {t('app.title')}
        </h1>
        <p className="mb-5 mt-1 text-center text-[12.5px] text-fg-3">{t('app.workspace')}</p>

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
            <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-50)', color: '#8C1B28' }}>
              {error}
            </div>
          )}
          <Button type="submit" variant="primary" size="lg" disabled={!username.trim() || !password || busy}>
            {busy ? '登录中…' : '登录'}
          </Button>
        </form>

        {lark?.configured && (
          <>
            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] text-fg-3">或</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <Button
              variant="secondary"
              size="lg"
              className="w-full"
              onClick={() => {
                window.location.href = lark.url ?? '/api/auth/lark/login';
              }}
            >
              <ScanQrCode size={16} /> 飞书扫码登录
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
