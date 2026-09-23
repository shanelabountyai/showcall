import { hhmm, shortDay, type LocalDate } from '../time';

/**
 * The cue graph (P0-2). Pure: agenda sessions and cue specs in, every derived
 * time and every problem out. A cue is fixed (day + startMin) or anchored to
 * a session's or cue's start/end plus an offset — "doors 30 before the
 * keynote" — so moving the keynote moves the doors. An optional end-by anchor
 * gives the cue a deadline; slack is the minutes left before it.
 *
 * - cycle:          anchors loop back on themselves. Named once; cues that
 *                   depend on the loop fail silently.
 * - anchor_missing: a start or end-by anchor that is not in the agenda or the
 *                   cue list — a session cut from a new version.
 * - outside_day:    the derived time falls before 0:00 or past 24:00 (D-002).
 * - compressed:     the cue ends past its end-by: negative slack, impossible.
 */
export type Edge = 'start' | 'end';
export type SessionTiming = { id: string; title: string; day: LocalDate; startMin: number; endMin: number };
export type CueSpec = {
  id: string; label: string; durationMin: number;
  day: LocalDate | null; startMin: number | null;
  anchorId: string | null; anchorEdge: Edge | null; offsetMin: number;
  endById: string | null; endByEdge: Edge | null; endByOffsetMin: number;
};
/** `room` is set by the cascade, which knows rooms; the pure graph never needs it. */
export type Span = { day: LocalDate; startMin: number; endMin: number; room?: string };
export type Timing = Span & { slack?: number };
export type ProblemKind = 'cycle' | 'anchor_missing' | 'outside_day' | 'compressed';
export type Problem = { kind: ProblemKind; cueId: string; message: string };
export type Moved = { id: string; from: Span | null; to: Span | null };

const edgeMin = (t: Span, edge: Edge) => (edge === 'start' ? t.startMin : t.endMin);
const dayMin = (d: LocalDate) => Date.parse(d) / 60_000;

export function resolveCues(sessions: SessionTiming[], cues: CueSpec[]) {
  const timings = new Map<string, Timing>(sessions.map((s) => [s.id, { day: s.day, startMin: s.startMin, endMin: s.endMin }]));
  const name = new Map([...sessions.map((s) => [s.id, s.title] as const), ...cues.map((c) => [c.id, c.label] as const)]);
  const q = (id: string) => `"${name.get(id)}"`;
  const cueById = new Map(cues.map((c) => [c.id, c]));
  const problems: Problem[] = [];
  const failed = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string): Timing | undefined => {
    const known = timings.get(id);
    if (known || failed.has(id)) return known;
    const cue = cueById.get(id)!;
    const loopAt = stack.indexOf(id);
    if (loopAt >= 0) {
      const loop = stack.slice(loopAt);
      loop.forEach((c) => failed.add(c));
      problems.push({ kind: 'cycle', cueId: id, message: `${[...loop, id].map(q).join(' → ')} anchor in a loop` });
      return undefined;
    }
    let day: LocalDate, startMin: number;
    if (cue.anchorId === null) {
      day = cue.day!; startMin = cue.startMin!;
    } else {
      if (!name.has(cue.anchorId)) {
        failed.add(id);
        problems.push({ kind: 'anchor_missing', cueId: id, message: `${q(id)} is anchored to a session or cue that is not on this agenda` });
        return undefined;
      }
      stack.push(id);
      const anchor = visit(cue.anchorId);
      stack.pop();
      if (!anchor) { failed.add(id); return undefined; }
      day = anchor.day; startMin = edgeMin(anchor, cue.anchorEdge!) + cue.offsetMin;
    }
    const t: Timing = { day, startMin, endMin: startMin + cue.durationMin };
    if (t.startMin < 0 || t.endMin > 1440) {
      problems.push({ kind: 'outside_day', cueId: id, message: `${q(id)} falls outside ${shortDay(day)}: ${t.startMin} to ${t.endMin} minutes after midnight` });
    }
    timings.set(id, t);
    return t;
  };
  for (const c of cues) visit(c.id);

  // End-by never moves the cue, so it cannot loop; resolve it after every start.
  for (const c of cues) {
    const t = timings.get(c.id);
    if (!t || c.endById === null) continue;
    if (!name.has(c.endById)) {
      problems.push({ kind: 'anchor_missing', cueId: c.id, message: `${q(c.id)} must end by a session or cue that is not on this agenda` });
      continue;
    }
    const target = timings.get(c.endById);
    if (!target) continue;
    const by = edgeMin(target, c.endByEdge!) + c.endByOffsetMin;
    t.slack = dayMin(target.day) + by - (dayMin(t.day) + t.endMin);
    if (t.slack < 0) {
      problems.push({ kind: 'compressed', cueId: c.id, message: `${q(c.id)} ends ${hhmm(t.endMin)} ${shortDay(t.day)} but must end by ${q(c.endById)} ${c.endByEdge} ${hhmm(by)} — ${-t.slack} min short` });
    }
  }
  return { timings, problems };
}

const span = (t: Timing | undefined): Span | null => (t ? { day: t.day, startMin: t.startMin, endMin: t.endMin, ...(t.room !== undefined && { room: t.room }) } : null);

/** Everything whose day, times or room differ — the cascade a change implies. Slack alone is not a move. */
export function diffTimings(before: Map<string, Timing>, after: Map<string, Timing>): Moved[] {
  const ids = new Set([...after.keys(), ...before.keys()]);
  return [...ids].flatMap((id) => {
    const from = span(before.get(id)), to = span(after.get(id));
    return JSON.stringify(from) === JSON.stringify(to) ? [] : [{ id, from, to }];
  });
}
