/**
 * Every environment variable the app reads, validated once at server start
 * (`instrumentation.ts`, K11). `.env.example` names exactly these, and
 * `src/env.test.ts` sweeps the code for any `process.env` read missing here.
 *
 * The checks are deliberately no stricter than the code that reads each key:
 * this refuses a malformed value at boot instead of at first use, it does not
 * change what a well-formed one means. An empty `NAME=` line counts as unset.
 */
type Check = (v: string) => boolean;

const anything: Check = (v) => v.length > 0;
const postgresUrl: Check = (v) => { try { return /^postgres(ql)?:$/.test(new URL(v).protocol); } catch { return false; } };
const positiveInt: Check = (v) => /^[1-9]\d*$/.test(v);

export const ENV = {
  /** Local Postgres; src/db.ts and prisma.config.ts refuse a cloud host unless SHOWCALL_ALLOW_CLOUD_DB is set. */
  DATABASE_URL: { required: true, check: postgresUrl },
  /** Migrations only (prisma.config.ts). */
  SHADOW_DATABASE_URL: { required: false, check: postgresUrl },
  /** Reaching a cloud database has to be typed (D-032 deploy). */
  SHOWCALL_ALLOW_CLOUD_DB: { required: false, check: anything },
  /** The deployed demo's shared password (D-032, src/demo-gate.ts). Unset on Vercel = every request is a 503. */
  DEMO_ACCESS_PASSWORD: { required: false, check: anything },
  /** Vercel Cron's bearer (src/cron-auth.ts). Unset in production = /api/cron refuses. */
  CRON_SECRET: { required: false, check: anything },
  /** Showcall Live test hooks (D-043): '1' in .env.test only, never on Vercel. */
  LIVE_TEST_HOOKS: { required: false, check: anything },
  /** Live stream poll interval and maximum stream length, in ms (src/live/routes.ts). */
  LIVE_POLL_MS: { required: false, check: positiveInt },
  LIVE_MAX_MS: { required: false, check: positiveInt },
  /** Set by Next.js and by Vercel; never set by hand. */
  NODE_ENV: { required: false, check: (v) => ['development', 'test', 'production'].includes(v) },
  VERCEL: { required: false, check: anything },
} as const satisfies Record<string, { required: boolean; check: Check }>;

export type EnvKey = keyof typeof ENV;

/** Throws naming the bad keys only, never their values. */
export function parseEnv(source: Partial<Record<string, string | undefined>>): Partial<Record<EnvKey, string>> {
  const out: Partial<Record<EnvKey, string>> = {};
  const bad: string[] = [];
  for (const [key, { required, check }] of Object.entries(ENV) as [EnvKey, { required: boolean; check: Check }][]) {
    const v = source[key];
    if (v === undefined || v === '') { if (required) bad.push(key); continue; }
    if (!check(v)) bad.push(key);
    else out[key] = v;
  }
  if (bad.length) throw new Error(`Invalid environment: ${bad.join(', ')}`);
  return out;
}
