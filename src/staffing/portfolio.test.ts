import { describe, expect, it } from 'vitest';
import { instantOf } from '../time';
import { staffConflicts, type Shift } from './portfolio';

let n = 0;
const s = (eventId: string, timezone: string, day: string, startMin: number, endMin: number, staffId = 'dana'): Shift =>
  ({ id: `s${++n}`, staffId, eventId, eventName: eventId, timezone, day, startMin, endMin });

describe('instantOf', () => {
  it('reads a wall clock in its timezone, across DST and midnight', () => {
    expect(instantOf('2026-10-13', 540, 'America/Chicago').toISOString()).toBe('2026-10-13T14:00:00.000Z');
    expect(instantOf('2026-11-02', 540, 'America/Chicago').toISOString()).toBe('2026-11-02T15:00:00.000Z'); // CST after fall-back
    expect(instantOf('2026-10-13', 1500, 'America/Los_Angeles').toISOString()).toBe('2026-10-14T08:00:00.000Z');
  });
});

describe('staffConflicts', () => {
  it('flags a short rest between two events, measured in real time', () => {
    // ends 23:00 CT; 06:00 PT next day is 08:00 CT → 9h
    const [c] = staffConflicts([s('summit', 'America/Chicago', '2026-10-13', 900, 1380), s('roadshow', 'America/Los_Angeles', '2026-10-14', 360, 720)]);
    expect(c).toMatchObject({ kind: 'turnaround', restMin: 540, a: { eventId: 'summit' }, b: { eventId: 'roadshow' } });
  });

  it('leaves enough rest, a split call on one event, and other people alone', () => {
    expect(staffConflicts([
      s('summit', 'America/Chicago', '2026-10-13', 900, 1380), s('roadshow', 'America/Los_Angeles', '2026-10-14', 420, 720), // 10h exactly
      s('summit', 'America/Chicago', '2026-10-15', 360, 600), s('summit', 'America/Chicago', '2026-10-15', 660, 900),
      s('kickoff', 'America/Chicago', '2026-10-13', 900, 1380, 'jun'),
    ])).toEqual([]);
  });

  it('flags an overlap even when the wall clocks do not', () => {
    const [c] = staffConflicts([s('summit', 'America/Chicago', '2026-10-13', 780, 1020), s('roadshow', 'America/Los_Angeles', '2026-10-13', 600, 780)]);
    expect(c).toMatchObject({ kind: 'overlap', restMin: -120 });
  });
});
