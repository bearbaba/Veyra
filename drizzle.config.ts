import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema:  './server/db/schema/index.ts',
  out:     './server/db/migrations',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@127.0.0.1:5432/veyra',
  },
  verbose: true,
  strict:  true,
});
