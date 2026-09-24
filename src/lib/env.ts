// Centralized server-side env access. Import this from server code only
// (route handlers, server components, scripts) — never from client components.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://postgres:postgres@livebook:5433/spms',
  // Secret used to sign session tokens (jose). Generate with:
  //   openssl rand -hex 32
  get sessionSecret() {
    return required('SESSION_SECRET');
  },
  // Static bearer key for the MCP endpoint.
  get mcpApiKey() {
    return required('MCP_API_KEY');
  },
  /* CONFIG_CRYPTO_KEY（AES-256-GCM,64 hex）由 src/server/crypto.ts 直接读
     process.env(保持零依赖,scripts 可复用)——敏感 DB 配置的加解密入口。 */
  // Public origin of the deployment, without trailing slash (e.g.
  // https://spms.innev.cn). Set it when running behind a reverse proxy that
  // rewrites the Host header: OAuth redirect URIs and post-login redirects are
  // built from this instead of the internal request origin.
  publicOrigin: process.env.PUBLIC_ORIGIN?.replace(/\/+$/, ''),
  /* 三方登录配置来源开关：
     - auto（默认）：DB（oauth_provider_configs 启用行）优先，env 兜底
     - db：只用数据库配置，完全不读各 provider 的 env（FEISHU/LARK/GITHUB 前缀）
     - env：只用环境变量，数据库里的配置不生效（管理面板的修改不会作用于登录） */
  oauthConfigSource: ((): 'auto' | 'db' | 'env' => {
    const v = process.env.OAUTH_CONFIG_SOURCE ?? 'auto';
    if (v === 'auto' || v === 'db' || v === 'env') return v;
    console.warn(`[env] OAUTH_CONFIG_SOURCE 取值无效（${v}），回退为 auto`);
    return 'auto';
  })(),
  // Feishu (飞书, CN) OAuth login — optional; the 飞书 button is hidden when unset.
  // *RedirectUri 只填路径部分（如 /api/auth/feishu/callback），host 由
  // publicOrigin 拼接，从而随部署环境切换；完整 URL 形式也兼容（原样使用）。
  feishuAppId: process.env.FEISHU_APP_ID,
  feishuAppSecret: process.env.FEISHU_APP_SECRET,
  feishuRedirectUri: process.env.FEISHU_REDIRECT_URI || undefined,
  // Lark (international) OAuth login — optional; the Lark button is hidden when unset.
  larkAppId: process.env.LARK_APP_ID,
  larkAppSecret: process.env.LARK_APP_SECRET,
  larkRedirectUri: process.env.LARK_REDIRECT_URI || undefined,
  // GitHub OAuth login (OAuth App) — optional; the GitHub button is hidden when unset.
  githubClientId: process.env.GITHUB_CLIENT_ID,
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
  githubRedirectUri: process.env.GITHUB_REDIRECT_URI || undefined,
  // Notion integration (public OAuth) — optional; the settings-page connect
  // button is disabled with a hint when unset.
  notionClientId: process.env.NOTION_CLIENT_ID,
  notionClientSecret: process.env.NOTION_CLIENT_SECRET,
  notionRedirectUri: process.env.NOTION_REDIRECT_URI || undefined,
  // Seed-only: overrides the default admin password ('admin123').
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD,
} as const;
