import { describe, expect, it } from 'vitest';
import { diffTimings, resolveCues, type CueSpec, type SessionTiming } from './cues';

const D1 = '2026-10-13';
const D2 = '2026-10-14';
const keynote: SessionTiming = { id: 'key', title: 'Keynote', day: D1, startMin: 540, endMin: 600 };
const panel: SessionTiming = { id: 'pan', title: 'Panel', day: D1, startMin: 660, endMin: 720 };

const blank = { durationMin: 0, day: null, startMin: null, anchorId: null, anchorEdge: null, offsetMin: 0, endById: null, endByEdge: null, endByOffsetMin: 0 } as const;
const cue = (id: string, spec: Partial<CueSpec>): CueSpec => ({ ...blank, id, label: id, ...spec });
const at = (anchorId: string, anchorEdge: 'start' | 'end', offsetMin = 0) => ({ anchorId, anchorEdge, offsetMin });

// The keynote's production items: doors 30 before, walk-in music from doors
// to the top, strike after; reset between keynote and panel must finish by
// the panel's start.
const show = [
  cue('doors', at('key', 'start', -30)),
  cue('walkin', { ...at('doors', 'start'), durationMin: 30 }),
  cue('strike', { ...at('key', 'end'), durationMin: 20 }),
  cue('reset', { ...at('strike', 'end'), durationMin: 30, endById: 'pan', endByEdge: 'start' }),
  cue('loadin', { day: D1, startMin: 360, durationMin: 90 }),
];

const kinds = (r: ReturnType<typeof resolveCues>) => r.problems.map((p) => `${p.kind}:${p.cueId}`);

describe('resolveCues', () => {
  it('derives every cue from its anchor chain, and slack against its end-by', () => {
    const { timings, problems } = resolveCues([keynote, panel], show);
    expect(problems).toEqual([]);
    expect(timings.get('doors')).toEqual({ day: D1, startMin: 510, endMin: 510 });
    expect(timings.get('walkin')).toEqual({ day: D1, startMin: 510, endMin: 540 });
    expect(timings.get('strike')).toEqual({ day: D1, startMin: 600, endMin: 620 });
    expect(timings.get('reset')).toEqual({ day: D1, startMin: 620, endMin: 650, slack: 10 });
    expect(timings.get('loadin')).toEqual({ day: D1, startMin: 360, endMin: 450 });
  });

  it('a session move cascades to exactly its dependents', () => {
    const before = resolveCues([keynote, panel], show);
    const after = resolveCues([{ ...keynote, startMin: 555, endMin: 615 }, panel], show);
    expect(diffTimings(before.timings, after.timings).map((m) => [m.id, m.from?.startMin, m.to?.startMin])).toEqual([
      ['key', 540, 555], ['doors', 510, 525], ['walkin', 510, 525], ['strike', 600, 615], ['reset', 620, 635],
    ]);
    expect(after.timings.get('reset')!.slack).toBe(-5);
  });

  it('names impossible compression: the reset cannot finish before the panel', () => {
    const { problems } = resolveCues([{ ...keynote, startMin: 555, endMin: 615 }, panel], show);
    expect(problems).toEqual([{ kind: 'compressed', cueId: 'reset', message: '"reset" ends 11:05 Tue, Oct 13 but must end by "Panel" start 11:00 — 5 min short' }]);
  });

  it('exact fit is zero slack, not a problem', () => {
    const { timings, problems } = resolveCues([keynote, { ...panel, startMin: 650 }], show);
    expect(timings.get('reset')!.slack).toBe(0);
    expect(problems).toEqual([]);
  });

  it('measures slack across days', () => {
    const { timings } = resolveCues([keynote, { ...panel, day: D2, startMin: 0 }], show);
    expect(timings.get('reset')!.slack).toBe(1440 - 650);
  });

  it('names a cycle once; its dependents fail silently; the rest resolves', () => {
    const r = resolveCues([keynote], [cue('a', at('b', 'end')), cue('b', at('a', 'end')), cue('c', at('a', 'start')), cue('d', at('key', 'start'))]);
    expect(kinds(r)).toEqual(['cycle:a']);
    expect(r.problems[0]!.message).toBe('"a" → "b" → "a" anchor in a loop');
    expect([...r.timings.keys()]).toEqual(['key', 'd']);
  });

  it('a cue anchored to itself is a cycle', () => {
    expect(kinds(resolveCues([], [cue('a', at('a', 'end'))]))).toEqual(['cycle:a']);
  });

  it('names an anchor that is not in the agenda (session cut) — start or end-by', () => {
    const r = resolveCues([keynote], [cue('doors', at('gone', 'start')), cue('reset', { ...at('key', 'end'), endById: 'gone', endByEdge: 'start' })]);
    expect(kinds(r)).toEqual(['anchor_missing:doors', 'anchor_missing:reset']);
  });

  it('names a cue pushed off the day', () => {
    const r = resolveCues([{ ...keynote, startMin: 10, endMin: 60 }, { ...panel, startMin: 1400, endMin: 1430 }],
      [cue('doors', at('key', 'start', -30)), cue('strike', { ...at('pan', 'end'), durationMin: 20 })]);
    expect(kinds(r)).toEqual(['outside_day:doors', 'outside_day:strike']);
  });
});
