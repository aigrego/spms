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
  // Public origin of the deployment, without trailing slash (e.g.
  // https://spms.innev.cn). Set it when running behind a reverse proxy that
  // rewrites the Host header: OAuth redirect URIs and post-login redirects are
  // built from this instead of the internal request origin.
  publicOrigin: process.env.PUBLIC_ORIGIN?.replace(/\/+$/, ''),
  // Feishu (飞书, CN) OAuth login — optional; the 飞书 button is hidden when unset.
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
