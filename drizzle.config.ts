import { defineConfig } from 'drizzle-kit';
// drizzle-kit 只自动加载 .env，不认 Next 的 .env.local。
// 这里用 Next 自带的加载器补齐（优先级：process.env > .env.local > .env），
// 且必须在读取 process.env 之前调用。
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('Missing DATABASE_URL — set it in .env.local or .env (see .env.example)');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url,
  },
});
