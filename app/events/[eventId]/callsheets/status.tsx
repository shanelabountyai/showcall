'use client';

import type { ProducerData } from '@/src/live/frames';
import { useLive } from '../../../live-stream';

/**
 * One role's issue line and work-rule warnings, from the live producer frame
 * (D-041): NEEDS RE-ISSUE flips the moment a cue edit commits anywhere, and
 * only for the roles whose sheet it changed. `confirmedAt` is the server's
 * stamp from the last render; the frame says whether a receipt is awaited.
 */
export function RoleStatus({ roleId, confirmedAt }: { roleId: string; confirmedAt: string | null }) {
  const { state } = useLive<ProducerData>();
  const s = state.data.callSheets.find((x) => x.roleId === roleId);
  if (!s) return null;
  return (
    <>
      <p data-testid="role-status" data-stale={s.stale}>
        {s.lastIssue === 0 ? 'Not issued yet' : `Issue ${s.lastIssue}`}
        {s.stale && ' · NEEDS RE-ISSUE'}
        {s.lastIssue > 0 && (!s.awaitingReceipt ? ` · receipt confirmed${confirmedAt ? ` ${confirmedAt}` : ''}` : ' · awaiting receipt')}
      </p>
      {s.warnings.length > 0 && <ul aria-label="Work rules">{s.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
    </>
  );
}
