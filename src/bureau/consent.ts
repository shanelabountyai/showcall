/**
 * The structural consent gate (hard rule 6): no code path distributes an
 * unreleased asset. Modelled as a filter, like projectCallSheet — callers
 * get back only what may leave, so there is nothing to forget to check.
 * `consentRecordedAt` null withholds every kind regardless of the flags:
 * an unanswered speaker is not a "no", but it is not a "yes" either.
 */
export type AssetKind = 'recording' | 'deck' | 'video';
export type ConsentSpeaker = {
  name: string; consentRecordedAt: Date | null;
  consentRecordSession: boolean; consentDistributeDeck: boolean; consentPublishVideo: boolean;
};

const FLAG: Record<AssetKind, keyof ConsentSpeaker> = {
  recording: 'consentRecordSession', deck: 'consentDistributeDeck', video: 'consentPublishVideo',
};

/** The reason `kind` may not leave for this speaker, or null if it may. */
export function withheld(speaker: ConsentSpeaker, kind: AssetKind): string | null {
  if (!speaker.consentRecordedAt) return `${speaker.name}'s consent has not been recorded`;
  if (!speaker[FLAG[kind]]) return `${speaker.name} did not consent to ${kind}`;
  return null;
}

/** Partitions items into what may release and what is withheld, with why. */
export function releasable<T>(items: T[], speakerOf: (item: T) => ConsentSpeaker, kind: AssetKind) {
  const released: T[] = [];
  const withheldItems: { item: T; reason: string }[] = [];
  for (const item of items) {
    const reason = withheld(speakerOf(item), kind);
    if (reason) withheldItems.push({ item, reason });
    else released.push(item);
  }
  return { released, withheld: withheldItems };
}
