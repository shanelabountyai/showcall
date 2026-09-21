import { describe, expect, it } from 'vitest';
import { detectConflicts, type GridRoom, type GridSession } from './conflicts';

const rooms: GridRoom[] = [
  { id: 'A', name: 'Ballroom A', strikeMinutes: 10, resetMinutes: 5 },
  { id: 'B', name: 'Salon B', strikeMinutes: 0, resetMinutes: 0 },
];
const D1 = '2026-10-13';
const D2 = '2026-10-14';
let n = 0;
const s = (roomId: string, startMin: number, endMin: number, speakers: string[] = [], day = D1): GridSession =>
  ({ id: `s${++n}`, title: `Session ${n}`, day, roomId, startMin, endMin, speakers: speakers.map((id) => ({ id, name: `Speaker ${id}` })) });

const kinds = (grid: GridSession[]) => detectConflicts(grid, rooms).map((c) => c.kind);

describe('detectConflicts', () => {
  it('passes a clean grid', () => {
    expect(kinds([s('A', 540, 600, ['x']), s('A', 615, 660, ['x']), s('B', 540, 600, ['y'])])).toEqual([]);
  });

  it('names a room double-booking with both sessions and the room', () => {
    const a = s('A', 540, 600), b = s('A', 570, 630);
    const [c, ...rest] = detectConflicts([a, b], rooms);
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ kind: 'room_double_booked', sessionIds: [a.id, b.id] });
    expect(c!.message).toBe(`Ballroom A is double-booked Tue, Oct 13: "${a.title}" 9:00–10:00 overlaps "${b.title}" 9:30–10:30`);
  });

  it('catches an overlap hidden behind a shorter session (not just neighbours)', () => {
    const long = s('B', 540, 720), short = s('B', 560, 580), late = s('B', 700, 760);
    const found = detectConflicts([long, short, late], rooms).filter((c) => c.kind === 'room_double_booked');
    expect(found.map((c) => c.sessionIds)).toEqual([[long.id, short.id], [long.id, late.id]]);
  });

  it('flags turnover shorter than strike + reset, and accepts it exactly', () => {
    expect(kinds([s('A', 540, 600), s('A', 614, 660)])).toEqual(['turnover_short']);
    expect(kinds([s('A', 540, 600), s('A', 615, 660)])).toEqual([]);
    const [c] = detectConflicts([s('A', 540, 600), s('A', 610, 660)], rooms);
    expect(c!.message).toMatch(/Ballroom A needs 15 min turnover .* has 10/);
  });

  it('treats back-to-back as fine in a zero-turnover room', () => {
    expect(kinds([s('B', 540, 600), s('B', 600, 660)])).toEqual([]);
  });

  it('puts a speaker in two places only when the times overlap', () => {
    expect(kinds([s('A', 540, 600, ['x']), s('B', 600, 660, ['x'])])).toEqual([]);
    const a = s('A', 540, 600, ['x', 'y']), b = s('B', 590, 660, ['x']);
    const [c, ...rest] = detectConflicts([a, b], rooms);
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ kind: 'speaker_double_booked', sessionIds: [a.id, b.id] });
    expect(c!.message).toMatch(/^Speaker x is in two places Tue, Oct 13/);
  });

  it('never compares across days', () => {
    expect(kinds([s('A', 540, 600, ['x']), s('A', 540, 600, ['x'], D2)])).toEqual([]);
  });

  it('refuses a session in a room the grid does not know', () => {
    expect(() => detectConflicts([s('Z', 540, 600)], rooms)).toThrow(/unknown room Z/);
  });
});
