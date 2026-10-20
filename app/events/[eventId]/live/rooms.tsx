'use client';

import type { LiveData } from '@/src/live/frames';
import { hhmm, shortDay } from '@/src/time';
import { MissedList, useLive } from '../../../live-stream';

const signed = (min: number) => (min === 0 ? 'on time' : min > 0 ? `${min} min late` : `${-min} min early`);

/**
 * Live mode's rooms, from the live stream (LV-3): a GO in another room, a row
 * edit or a minute rollover (D-046) lands here without the old 5 s refresh.
 * GO stays a server action that re-checks the stage manager (D-011).
 */
export function LiveRooms({ go, rebase, as, goRooms }: {
  go: (form: FormData) => Promise<void>; rebase: () => Promise<void>; as: string;
  /** Rooms the picked stage manager may call; null when they cover every room. */
  goRooms: string[] | null;
}) {
  const { state } = useLive<LiveData>();
  const live = state.data;
  const canGo = (room: string) => !!as && (goRooms === null || goRooms.includes(room));
  return (
    <>
      <p>{shortDay(live.day)} · now {hhmm(live.nowMin)}</p>
      <MissedList />
      {live.stale && (
        <form action={rebase}>
          <p role="alert"><strong>The agenda has published past this run sheet.</strong> Times shown are the run sheet as built; rebase it.</p>
          <button type="submit">Rebase and re-issue call sheets</button>
        </form>
      )}
      {live.rooms.length === 0 && <p>Nothing on the run sheet today.</p>}
      {live.rooms.map((room) => (
        <section key={room.room}>
          <h2>{room.room} — {signed(room.offsetMin)}</h2>
          <p>Current: {room.current?.label ?? '—'} · Next: {room.next ? `${room.next.label} at ${hhmm(room.next.projectedMin)}` : '—'}</p>
          <table>
            <thead><tr><th>Planned</th><th>Projected</th><th>Row</th><th></th></tr></thead>
            <tbody>
              {room.rows.map((r) => (
                <tr key={r.id} data-state={r.state} aria-current={r.state === 'current' ? 'step' : undefined}>
                  <td>{hhmm(r.startMin)}</td>
                  <td>{r.projectedMin === r.startMin ? '' : hhmm(r.projectedMin)}</td>
                  <td>{r.state === 'current' ? <strong>{r.label}</strong> : r.label}</td>
                  <td>
                    {canGo(room.room) && (
                      <form action={go}>
                        <input type="hidden" name="rowId" value={r.id} />
                        <input type="hidden" name="staffId" value={as} />
                        <button type="submit">GO</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}
