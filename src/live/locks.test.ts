import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { approve, override } from '../content/lock';
import { makeDeck, makeSpeaker, resetDb } from '../test/harness';
import { clock, smallShow } from '../test/live-show';
import { buildFrame, type ProducerData } from './frames';

beforeEach(resetDb);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : [p]; });
}

const deckState = async (eventId: string) => ((await buildFrame('runsheet', eventId, { clock, since: null }))!.data as ProducerData).content[0];

/** L1.8 (D-042): show-file state on the channel is read at send time and never written. */
describe('show-file locks on the live channel', () => {
  it('approve v7, then a portal upload v8: the frame shows latest 8, show file 7; only an override moves the show file', async () => {
    const { event } = await smallShow();
    const speaker = await makeSpeaker(event.id, { name: 'Hollis Grant' });
    let v = await makeDeck(speaker.id, 'passed');
    for (let i = 2; i <= 7; i++) v = await makeDeck(speaker.id, 'passed');
    await approve(v.id, clock);
    expect(await deckState(event.id)).toMatchObject({ owner: 'Hollis Grant', latest: 7, showFile: 7 });

    const v8 = await makeDeck(speaker.id, 'passed'); // after lock: kept, never the show file
    expect(await deckState(event.id)).toMatchObject({ latest: 8, showFile: 7 });

    await override(v8.id, 'Speaker fixed a typo on slide 4', clock);
    expect(await deckState(event.id)).toMatchObject({ latest: 8, showFile: 8 });
  });

  it('guard: nothing under src/live or app/api/live writes a show-file lock, approves or overrides', () => {
    const live = [...files('src/live'), ...files('app/api/live')].filter((f) => !f.endsWith('.test.ts'));
    expect(live.length).toBeGreaterThan(3);
    for (const f of live) {
      const src = readFileSync(f, 'utf8');
      for (const banned of ['showFileLock.create', 'showFileLock.update', 'showFileLock.upsert', 'showFileLock.delete', 'approve(', 'override(']) {
        expect(src, `${f} contains ${banned}`).not.toContain(banned);
      }
    }
  });
});
