import { describe, expect, it } from 'vitest';
import { releasable, withheld, type AssetKind, type ConsentSpeaker } from './consent';

const KINDS: AssetKind[] = ['recording', 'deck', 'video'];
const FLAGS = ['consentRecordSession', 'consentDistributeDeck', 'consentPublishVideo'] as const;

function speaker(flags: Partial<Record<(typeof FLAGS)[number], boolean>>, recorded: boolean): ConsentSpeaker {
  return {
    name: 'Dana Reyes', consentRecordedAt: recorded ? new Date('2026-09-01') : null,
    consentRecordSession: false, consentDistributeDeck: false, consentPublishVideo: false,
    ...flags,
  };
}

/** Every flag combination × every kind × recorded/unrecorded — the no-path sweep (hard rule 6). */
describe('the consent gate', () => {
  it('withholds every kind when consent was never recorded, whatever the flags say', () => {
    for (const flags of powerset(FLAGS)) {
      const s = speaker(Object.fromEntries(flags.map((f) => [f, true])), false);
      for (const kind of KINDS) expect(withheld(s, kind)).toMatch(/consent has not been recorded/);
    }
  });

  it('releases a kind only when recorded and its own flag is true; withholds every other cell', () => {
    for (const flags of powerset(FLAGS)) {
      const s = speaker(Object.fromEntries(flags.map((f) => [f, true])), true);
      for (const [kind, flag] of [['recording', 'consentRecordSession'], ['deck', 'consentDistributeDeck'], ['video', 'consentPublishVideo']] as const) {
        const shouldRelease = flags.includes(flag);
        const reason = withheld(s, kind);
        if (shouldRelease) expect(reason).toBeNull();
        else expect(reason).toMatch(new RegExp(`did not consent to ${kind}`));
      }
    }
  });

  it('releasable() partitions disjointly and completely', () => {
    const speakers = [speaker({}, true), speaker({ consentDistributeDeck: true }, true), speaker({}, false)];
    const items = speakers.map((s, i) => ({ i, s }));
    const { released, withheld: held } = releasable(items, (x) => x.s, 'deck');
    expect(released.length + held.length).toBe(items.length);
    expect(released.map((r) => r.i)).toEqual([1]);
    expect(held.map((h) => h.item.i)).toEqual([0, 2]);
    expect(held[0]!.reason).toMatch(/did not consent to deck/);
    expect(held[1]!.reason).toMatch(/consent has not been recorded/);
  });
});

function powerset<T>(items: readonly T[]): T[][] {
  return items.reduce<T[][]>((sets, item) => sets.flatMap((s) => [s, [...s, item]]), [[]]);
}
