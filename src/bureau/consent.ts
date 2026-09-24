/**
 * The structural consent gate (hard rule 6): no code path distributes an
 * unreleased asset. Modelled as a filter, like projectCallSheet — callers
 * get back only what may leave, so there is nothing to forget to check.
 * `consentRecordedAt` null withholds every kind regardless of the flags:
 * an unanswered speaker is not a "no", but it is not a "yes" either.
 * A recording that leaves is a published video of the session, so it needs
 * both "record session" and "publish video" (D-031); a panel's recording
 * needs every panelist, and a session with nobody to ask is withheld.
 */
export type AssetKind = 'recording' | 'deck' | 'video';
export type ConsentSpeaker = {
  name: string; consentRecordedAt: Date | null;
  consentRecordSession: boolean; consentDistributeDeck: boolean; consentPublishVideo: boolean;
};

const FLAGS: Record<AssetKind, (keyof ConsentSpeaker)[]> = {
  recording: ['consentRecordSession', 'consentPublishVideo'], deck: ['consentDistributeDeck'], video: ['consentPublishVideo'],
};

/** The reason `kind` may not leave for this speaker, or null if it may. */
export function withheld(speaker: ConsentSpeaker, kind: AssetKind): string | null {
  if (!speaker.consentRecordedAt) return `${speaker.name}'s consent has not been recorded`;
  if (!FLAGS[kind].every((f) => speaker[f])) return `${speaker.name} did not consent to ${kind}`;
  return null;
}

/** Why an item owned by all of `speakers` may not leave — the first holdout — or null if every one consents. */
export function withheldAll(speakers: ConsentSpeaker[], kind: AssetKind): string | null {
  if (!speakers.length) return `nobody on it has given consent`;
  for (const s of speakers) { const reason = withheld(s, kind); if (reason) return reason; }
  return null;
}

/** Partitions items into what may release and what is withheld, with why. */
export function releasable<T>(items: T[], speakersOf: (item: T) => ConsentSpeaker[], kind: (item: T) => AssetKind) {
  const released: T[] = [];
  const withheldItems: { item: T; reason: string }[] = [];
  for (const item of items) {
    const reason = withheldAll(speakersOf(item), kind(item));
    if (reason) withheldItems.push({ item, reason });
    else released.push(item);
  }
  return { released, withheld: withheldItems };
}
