// Centralized server-side env access. Import this from server code only
// (route handlers, server components, scripts) — never from client components.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://postgres:postgres@livebook:5433/next_spms',
  // Secret used to sign session tokens (jose). Generate with:
  //   openssl rand -hex 32
  get sessionSecret() {
    return required('SESSION_SECRET');
  },
  // Static bearer key for the MCP endpoint.
  get mcpApiKey() {
    return required('MCP_API_KEY');
  },
  // Feishu (飞书, CN) OAuth login — optional; the 飞书 button is hidden when unset.
  feishuAppId: process.env.FEISHU_APP_ID,
  feishuAppSecret: process.env.FEISHU_APP_SECRET,
  feishuRedirectUri: process.env.FEISHU_REDIRECT_URI,
  // Lark (international) OAuth login — optional; the Lark button is hidden when unset.
  larkAppId: process.env.LARK_APP_ID,
  larkAppSecret: process.env.LARK_APP_SECRET,
  larkRedirectUri: process.env.LARK_REDIRECT_URI,
  // Notion integration (public OAuth) — optional; the settings-page connect
  // button is disabled with a hint when unset.
  notionClientId: process.env.NOTION_CLIENT_ID,
  notionClientSecret: process.env.NOTION_CLIENT_SECRET,
  notionRedirectUri: process.env.NOTION_REDIRECT_URI,
  // Seed-only: overrides the default admin password ('admin123').
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD,
} as const;
