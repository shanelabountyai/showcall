import { defineConfig } from 'prisma/config';

// Prisma 7 no longer auto-loads .env. Test runs inject DATABASE_URL via
// `dotenv -e .env.test`; this covers the plain CLI in development.
if (!process.env.DATABASE_URL) {
  const { config } = await import('dotenv');
  config({ path: '.env', quiet: true });
}

const url = process.env.DATABASE_URL!;
// A mistyped env pointing a migration at a cloud branch is the accident this
// catches. Reaching one on purpose has to be typed: SHOWCALL_ALLOW_CLOUD_DB=1.
if (!process.env.SHOWCALL_ALLOW_CLOUD_DB && /neon\.tech|rds\.amazonaws|supabase\.co/.test(url)) {
  throw new Error('Showcall runs on local Postgres. Refusing a cloud database.');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url, shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL },
});
