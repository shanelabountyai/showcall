import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENV, parseEnv } from './env';

const ok = { DATABASE_URL: 'postgresql://u@localhost:5432/showcall_test?connection_limit=10&pool_timeout=20' };

describe('parseEnv (K11)', () => {
  it('accepts the minimum, and treats an empty line as unset', () => {
    expect(parseEnv(ok)).toEqual(ok);
    expect(parseEnv({ ...ok, CRON_SECRET: '', LIVE_POLL_MS: '' })).toEqual(ok);
    expect(parseEnv({ ...ok, LIVE_POLL_MS: '250', NODE_ENV: 'production', VERCEL: '1', DEMO_ACCESS_PASSWORD: 'pw' })).toMatchObject({ LIVE_POLL_MS: '250' });
  });

  it('refuses a missing or malformed value, naming the key and never the value', () => {
    expect(() => parseEnv({})).toThrow('Invalid environment: DATABASE_URL');
    expect(() => parseEnv({ DATABASE_URL: 'mysql://secret-host/x' })).toThrow('Invalid environment: DATABASE_URL');
    expect(() => parseEnv({ ...ok, LIVE_POLL_MS: 'soon', LIVE_MAX_MS: '-5', NODE_ENV: 'prod' })).toThrow('Invalid environment: LIVE_POLL_MS, LIVE_MAX_MS, NODE_ENV');
    try { parseEnv({ DATABASE_URL: 'mysql://secret-host/x' }); } catch (e) { expect((e as Error).message).not.toContain('secret-host'); }
  });
});

/** Sweep: every `process.env` key the app reads is in the schema, and `.env.example` names exactly the schema's keys. */
describe('env inventory (K11)', () => {
  const root = join(__dirname, '..');
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (['node_modules', 'generated', '.next'].includes(f)) return [];
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
  });
  const sources = [...files(join(root, 'app')), ...files(join(root, 'src')), ...files(join(root, 'prisma')), ...['proxy.ts', 'prisma.config.ts', 'next.config.ts', 'instrumentation.ts'].map((f) => join(root, f))];

  it('the code reads no variable the schema does not know', () => {
    const read = new Set(sources.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]*)|\benv\.([A-Z][A-Z0-9_]{2,})/g)].map((m) => m[1] ?? m[2]!)));
    expect([...read].filter((k) => !(k in ENV))).toEqual([]);
  });

  it('.env.example names every schema key', () => {
    const example = readFileSync(join(root, '.env.example'), 'utf8');
    const named = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!));
    const platform = example.match(/^# Set by Next\.js and Vercel, never by hand: (.*)\.$/m)?.[1]?.split(', ') ?? [];
    for (const k of platform) named.add(k);
    expect(Object.keys(ENV).filter((k) => !named.has(k))).toEqual([]);
    expect([...named].filter((k) => !(k in ENV))).toEqual([]);
  });
});
