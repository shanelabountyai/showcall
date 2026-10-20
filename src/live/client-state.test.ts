import { describe, expect, it } from 'vitest';
import { applyFrame, dismissMissed, hold, statusText } from './client-state';
import type { Missed } from './stream';

/** L1.7: the client's frame rules, pure. Runs without a database or a browser. */
const m = (seq: number, actor = 'Priya Natarajan'): Missed => ({ seq, kinds: ['cue'], actor, at: '2026-10-13T15:00:00.000Z' });
const at = 1_000;

describe('a view holding frames', () => {
  it('drops a frame at or below the seq it holds, and applies a newer one', () => {
    let s = hold({ seq: 4, data: 'four' }, at);
    s = applyFrame(s, { seq: 3, data: 'three' }, { at });
    s = applyFrame(s, { seq: 4, data: 'four again' }, { at });
    expect(s).toMatchObject({ seq: 4, data: 'four', frames: 2 });
    s = applyFrame(s, { seq: 6, data: 'six' }, { at });
    expect(s).toMatchObject({ seq: 6, data: 'six', frames: 3 });
  });

  it('replaces on an equal seq for live mode (the minute frame), and only there', () => {
    const s = hold({ seq: 4, data: { nowMin: 600 } }, at);
    expect(applyFrame(s, { seq: 4, data: { nowMin: 601 } }, { at, replaceOnEqual: true }).data).toEqual({ nowMin: 601 });
    expect(applyFrame(s, { seq: 4, data: { nowMin: 601 } }, { at }).data).toEqual({ nowMin: 600 });
  });

  it('a replayed frame at an equal seq does not re-append missed entries', () => {
    let s = hold({ seq: 3, data: 'three' }, at);
    const resume = { seq: 5, data: 'five', missed: [m(4), m(5)] };
    s = applyFrame(s, resume, { at });
    s = applyFrame(s, resume, { at });
    s = applyFrame(s, { ...resume, missed: [m(5)] }, { at, replaceOnEqual: true });
    expect(s.missed.map((x) => x.seq)).toEqual([4, 5]);
    expect(s.seq).toBe(5);
  });

  it('keeps missed entries from a dropped frame once (a reconnect after the fallback refresh moved the seq)', () => {
    let s = hold({ seq: 3, data: 'three' }, at);
    s = applyFrame(s, { seq: 5, data: 'five' }, { at, fromChannel: false }); // the page re-rendered by the 5 s poll
    s = applyFrame(s, { seq: 5, data: 'five', missed: [m(4), m(5)] }, { at }); // then the stream came back
    expect(s.missed.map((x) => x.seq)).toEqual([4, 5]);
    expect(s.frames).toBe(1);
  });

  it('a dismissed entry never comes back', () => {
    let s = applyFrame(hold({ seq: 3, data: 'x' }, at), { seq: 5, data: 'y', missed: [m(4), m(5)] }, { at });
    s = dismissMissed(s);
    s = applyFrame(s, { seq: 6, data: 'z', missed: [m(5), m(6)] }, { at });
    expect(s.missed.map((x) => x.seq)).toEqual([6]);
  });

  it('stamps the time of the last frame received, not of a page re-render', () => {
    let s = hold({ seq: 1, data: 'a' }, 100);
    s = applyFrame(s, { seq: 2, data: 'b' }, { at: 200 });
    s = applyFrame(s, { seq: 3, data: 'c' }, { at: 300, fromChannel: false });
    expect(s.lastFrameAt).toBe(200);
  });

  it('says how old the screen is when it is not live', () => {
    expect(statusText('live', '10:42')).toBe('live');
    expect(statusText('reconnecting', '10:42')).toBe('reconnecting… (as of 10:42)');
    expect(statusText('offline', '10:42')).toBe('offline: refreshing every 5 s');
  });
});
