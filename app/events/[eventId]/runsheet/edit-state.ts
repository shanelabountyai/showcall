import type { CueRowState } from '@/src/runsheet/cascade';
import type { Moved } from '@/src/runsheet/cues';
import { inputTime } from '@/src/time';

/** A cue row's form as typed (strings, the way a form holds them). */
export type RowValues = {
  mode: 'fixed' | 'anchored';
  label: string; durationMin: string;
  day: string; start: string;
  anchorId: string; anchorEdge: 'start' | 'end'; offsetMin: string;
};

/**
 * What the row editor's action answers (D-039, D-045). The form keeps what the
 * person typed on every answer; `conflict` adds the row as it is now, who
 * changed it and when, and the rev to re-preview against.
 */
export type EditState =
  | { kind: 'idle' }
  | { kind: 'preview'; cueId: string; rev: number; expected: string; moved: Moved[]; problems: string[]; warnings: string[] }
  | { kind: 'committed'; cueId: string; issued: string | null }
  | { kind: 'refused'; cueId: string; message: string }
  | { kind: 'conflict'; cueId: string; message: string; by: string; at: string | null; current: RowValues; currentRev: number };

/** A cue row as the form holds it. Plain module: the server action and the client view both use it. */
export function valuesOf(c: CueRowState): RowValues {
  return {
    mode: c.anchorId === null ? 'fixed' : 'anchored',
    label: c.label, durationMin: String(c.durationMin),
    day: c.day ?? '', start: c.startMin === null ? '' : inputTime(c.startMin),
    anchorId: c.anchorId ?? '', anchorEdge: c.anchorEdge ?? 'start', offsetMin: String(c.offsetMin),
  };
}
