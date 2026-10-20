import { describe, expect, it } from 'vitest';
import { cronAllowed } from './cron-auth';

describe('cronAllowed', () => {
  const env = { CRON_SECRET: 's3cret-value', NODE_ENV: 'production' };

  it('runs only with the exact bearer secret', () => {
    expect(cronAllowed('Bearer s3cret-value', env)).toBe(true);
    expect(cronAllowed(null, env)).toBe(false);
    expect(cronAllowed('', env)).toBe(false);
    expect(cronAllowed('Bearer s3cret-valu', env)).toBe(false);
    expect(cronAllowed('Bearer s3cret-value ', env)).toBe(false);
    expect(cronAllowed('bearer s3cret-value', env)).toBe(false);
    expect(cronAllowed('s3cret-value', env)).toBe(false);
  });

  it('with no secret set: refused in production, open off it (dev, e2e)', () => {
    expect(cronAllowed(null, { NODE_ENV: 'production' })).toBe(false);
    expect(cronAllowed('Bearer anything', { NODE_ENV: 'production', CRON_SECRET: '' })).toBe(false);
    expect(cronAllowed(null, { NODE_ENV: 'development' })).toBe(true);
    expect(cronAllowed(null, {})).toBe(true);
  });
});
