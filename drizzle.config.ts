import { defineConfig } from 'drizzle-kit';
// 相对路径引入:drizzle-kit 在 Next 之外加载本配置,而 env.ts 是无 Next
// 依赖的纯 TS。DATABASE_URL 的默认值统一收敛在 src/lib/env.ts。
import { env } from './src/lib/env';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: env.databaseUrl,
  },
});
