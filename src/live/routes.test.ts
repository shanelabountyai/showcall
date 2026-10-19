import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueCallSheets } from '../callsheet/callsheet';
import { issueCrewLink } from '../callsheet/portal';
import { resetDb } from '../test/harness';
import { clock, smallShow, today } from '../test/live-show';
import { listen, request, sleep } from '../test/sse';
import * as crewRoute from '../../app/api/live/call/[token]/route';
import * as liveRoute from '../../app/api/live/[eventId]/live/route';
import * as runsheetRoute from '../../app/api/live/[eventId]/runsheet/route';
import { dropAfter, lastEventId } from './routes';

beforeEach(resetDb);
afterEach(() => { vi.unstubAllEnvs(); });

const ctx = <T>(params: T) => ({ params: Promise.resolve(params) });
const ROUTES = { crew: crewRoute, live: liveRoute, runsheet: runsheetRoute };

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : [p]; });
}

/** L1.6 (D-040, D-043): the routes, called as Next calls them. */
describe('live routes', () => {
  it('each route exports GET, force-dynamic and maxDuration 300, and nothing else', () => {
    for (const [name, mod] of Object.entries(ROUTES)) {
      expect(Object.keys(mod).sort(), name).toEqual(['GET', 'dynamic', 'maxDuration']);
      expect(mod.dynamic, name).toBe('force-dynamic');
      expect(mod.maxDuration, name).toBe(300);
    }
  });

  it('no route accepts a role, room or audience parameter: the only query parameters read are since and dropAfter', () => {
    const sources = [...files('app/api/live'), 'src/live/routes.ts', 'src/live/frames.ts', 'src/live/stream.ts'].map((f) => readFileSync(f, 'utf8'));
    const read = new Set(sources.flatMap((s) => [...s.matchAll(/searchParams\.get\(\s*'([^']+)'/g)].map((m) => m[1])));
    expect([...read].sort()).toEqual(['dropAfter', 'since']);
    for (const s of sources) expect(s).not.toMatch(/searchParams\.(getAll|entries|keys|forEach)|\.has\(\s*'(role|room|audience)'/);
  });

  it('a bad crew token is a 404 before any byte of stream', async () => {
    const { ac, req } = request('http://localhost/api/live/call/not-a-real-token');
    const res = await crewRoute.GET(req, ctx({ token: 'not-a-real-token' }));
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type') ?? '').not.toContain('event-stream');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await res.text()).toBe('Not found');
    ac.abort();
  });

  it('an unknown event is a 404 on both producer streams', async () => {
    for (const mod of [liveRoute, runsheetRoute]) {
      const { req } = request('http://localhost/api/live/nope/x');
      expect((await mod.GET(req, ctx({ eventId: 'nope' }))).status).toBe(404);
    }
  });

  it('a crew stream answers as an event stream with the portal headers', async () => {
    const { event, roles } = await smallShow({ day: today() });
    await issueCallSheets(event.id, clock);
    const token = await issueCrewLink(event.id, roles.audio.id);
    const { ac, req } = request(`http://localhost/api/live/call/${token}`);
    const res = await crewRoute.GET(req, ctx({ token }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const s = listen(res, ac);
    await s.until((f) => f.seq > 0);
    await s.close();
  });

  it('a reissued crew link closes its open stream within a poll, and a reconnect is a 404', async () => {
    vi.stubEnv('LIVE_POLL_MS', '100');
    const { event, roles } = await smallShow({ day: today() });
    await issueCallSheets(event.id, clock);
    const token = await issueCrewLink(event.id, roles.audio.id);
    const { ac, req } = request(`http://localhost/api/live/call/${token}`);
    const s = listen(await crewRoute.GET(req, ctx({ token })), ac);
    await s.until(() => true);
    await issueCrewLink(event.id, roles.audio.id); // the old link dies
    const t0 = performance.now();
    await Promise.race([s.done, sleep(3_000)]);
    expect(s.ended()).toBe(true);
    expect(performance.now() - t0).toBeLessThan(3_000);
    const again = request(`http://localhost/api/live/call/${token}`);
    expect((await crewRoute.GET(again.req, ctx({ token }))).status).toBe(404);
  });

  it('with LIVE_TEST_HOOKS unset, ?dropAfter= is ignored', async () => {
    vi.stubEnv('LIVE_TEST_HOOKS', '');
    expect(dropAfter(new Request('http://localhost/x?dropAfter=200'))).toBeNull();
    vi.stubEnv('LIVE_POLL_MS', '50');
    const { event } = await smallShow({ day: today() });
    const { ac, req } = request(`http://localhost/api/live/${event.id}/runsheet?dropAfter=200`);
    const s = listen(await runsheetRoute.GET(req, ctx({ eventId: event.id })), ac);
    await sleep(700);
    expect(s.ended()).toBe(false);
    await s.close();

    vi.stubEnv('LIVE_TEST_HOOKS', '1');
    expect(dropAfter(new Request('http://localhost/x?dropAfter=200'))).toBe(200);
  });

  it('Last-Event-ID wins over ?since=, and junk is a first visit', () => {
    expect(lastEventId(new Request('http://localhost/x?since=4', { headers: { 'Last-Event-ID': '7' } }))).toBe(7);
    expect(lastEventId(new Request('http://localhost/x?since=4'))).toBe(4);
    expect(lastEventId(new Request('http://localhost/x?since=-1'))).toBeNull();
    expect(lastEventId(new Request('http://localhost/x'))).toBeNull();
  });
});
