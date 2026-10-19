'use client';

import type { ProducerData } from '@/src/live/frames';
import { useLive } from './live-stream';

type Deliverable = ProducerData['content'][number];

/** "v8 uploaded, show file still v7" (D-042): the pointer as read when the frame was built; only a producer's override moves it. */
export function showFileLine(d: Deliverable) {
  if (d.showFile === null) return d.latest === 0 ? 'nothing uploaded yet' : `v${d.latest} uploaded, not locked`;
  return d.latest === d.showFile ? `show file v${d.showFile}` : `v${d.latest} uploaded, show file still v${d.showFile}`;
}

/** Show-file state for every deliverable, live from the producer stream (LV-6). */
export function ShowFileState() {
  const { state } = useLive<ProducerData>();
  const content = state.data.content;
  if (content.length === 0) return null;
  return (
    <details aria-label="Show files, live">
      <summary>Show files, live</summary>
      <ul>
        {content.map((d) => (
          <li key={d.id} data-deliverable={d.id} data-latest={d.latest} data-show-file={d.showFile ?? ''}>
            {d.owner ? `${d.owner}: ` : ''}{d.label} — {showFileLine(d)}
          </li>
        ))}
      </ul>
    </details>
  );
}
