import { hhmm, shortDay, type LocalDate } from '../time';
import { usd } from '../money';
import type { Timing } from '../runsheet/cues';

/**
 * Crew work rules (P1-1, D-027). Pure: the event's rules, each call role's
 * tagged cues and the resolved timings in; warnings out. A role is on the
 * clock from its call (first cue) to its wrap (last cue) on each day, which
 * is what its call sheet tells the crew. Warnings never refuse a change: a
 * producer may choose to pay the penalty, but sees what it costs first.
 *
 * - overtime:     call to wrap runs past `overtimeAfterMin`.
 * - meal_penalty: a stretch of more than `mealWithinMin` without a gap of at
 *                 least `mealBreakMin` between cues. Billed per started
 *                 `mealPenaltyStepMin` past the limit, so it is money.
 */
export type CrewRules = { overtimeAfterMin: number; mealWithinMin: number; mealBreakMin: number; mealPenaltyCents: number; mealPenaltyStepMin: number };
export type CrewRole = { id: string; name: string; cueIds: string[] };
export type CrewWarning = { kind: 'overtime' | 'meal_penalty'; roleId: string; day: LocalDate; cents: number; message: string };

export function crewWarnings(rules: CrewRules | null, roles: CrewRole[], timings: Map<string, Timing>): CrewWarning[] {
  if (!rules) return [];
  const warnings: CrewWarning[] = [];
  for (const role of roles) {
    const spans = role.cueIds.flatMap((id) => { const t = timings.get(id); return t ? [t] : []; });
    for (const [day, list] of Map.groupBy(spans, (t) => t.day)) {
      list.sort((a, b) => a.startMin - b.startMin);
      // Overlapping cues are one stretch of work.
      const work: { start: number; end: number }[] = [];
      for (const t of list) {
        const last = work.at(-1);
        if (last && t.startMin <= last.end) last.end = Math.max(last.end, t.endMin);
        else work.push({ start: t.startMin, end: t.endMin });
      }
      const call = work[0]!.start, wrap = work.at(-1)!.end;
      const add = (kind: CrewWarning['kind'], cents: number, message: string) => warnings.push({ kind, roleId: role.id, day, cents, message: `${role.name} ${shortDay(day)}: ${message}` });

      if (wrap - call > rules.overtimeAfterMin) {
        add('overtime', 0, `on the clock ${hhmm(call)}–${hhmm(wrap)}, ${wrap - call - rules.overtimeAfterMin} min past the ${hhmm(rules.overtimeAfterMin)} straight-time day`);
      }
      // The meal clock starts at call and restarts after every qualifying gap.
      let since = call;
      for (let i = 0; i < work.length; i++) {
        const next = work[i + 1];
        if (next && next.start - work[i]!.end < rules.mealBreakMin) continue;
        const over = work[i]!.end - since - rules.mealWithinMin;
        if (over > 0) {
          const cents = Math.ceil(over / rules.mealPenaltyStepMin) * rules.mealPenaltyCents;
          add('meal_penalty', cents, `no meal break ${hhmm(since)}–${hhmm(work[i]!.end)}, ${over} min past the ${hhmm(rules.mealWithinMin)} limit — ${usd(cents)} in meal penalties`);
        }
        if (next) since = next.start;
      }
    }
  }
  return warnings;
}
