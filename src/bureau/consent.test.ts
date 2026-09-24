import { describe, expect, it } from 'vitest';
import { releasable, withheld, withheldAll, type AssetKind, type ConsentSpeaker } from './consent';

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

  it('releases a kind only when recorded and all its flags are true; withholds every other cell', () => {
    const needs = { recording: ['consentRecordSession', 'consentPublishVideo'], deck: ['consentDistributeDeck'], video: ['consentPublishVideo'] } as const;
    for (const flags of powerset(FLAGS)) {
      const s = speaker(Object.fromEntries(flags.map((f) => [f, true])), true);
      for (const kind of KINDS) {
        const shouldRelease = needs[kind].every((f) => flags.includes(f));
        const reason = withheld(s, kind);
        if (shouldRelease) expect(reason).toBeNull();
        else expect(reason).toMatch(new RegExp(`did not consent to ${kind}`));
      }
    }
  });

  it('releasable() partitions disjointly and completely', () => {
    const speakers = [speaker({}, true), speaker({ consentDistributeDeck: true }, true), speaker({}, false)];
    const items = speakers.map((s, i) => ({ i, s }));
    const { released, withheld: held } = releasable(items, (x) => [x.s], () => 'deck');
    expect(released.length + held.length).toBe(items.length);
    expect(released.map((r) => r.i)).toEqual([1]);
    expect(held.map((h) => h.item.i)).toEqual([0, 2]);
    expect(held[0]!.reason).toMatch(/did not consent to deck/);
    expect(held[1]!.reason).toMatch(/consent has not been recorded/);
  });

  it('a shared item needs every owner: one holdout, or nobody at all, withholds it', () => {
    const yes = { ...speaker({ consentRecordSession: true, consentPublishVideo: true }, true), name: 'Ana' };
    const no = { ...speaker({ consentRecordSession: true }, true), name: 'Bo' };
    expect(withheldAll([yes], 'recording')).toBeNull();
    expect(withheldAll([yes, no], 'recording')).toBe('Bo did not consent to recording');
    expect(withheldAll([], 'recording')).toMatch(/nobody/);
  });
});

function powerset<T>(items: readonly T[]): T[][] {
  return items.reduce<T[][]>((sets, item) => sets.flatMap((s) => [s, [...s, item]]), [[]]);
}
