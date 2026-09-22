# Next

**S-7 shipped** (speaker bureau: lifecycle guards + logged step-back,
rehearsal slots reusing the conflict engine, consent as a structural filter).
D-013/D-014 recorded. `docs/backlog.md` S-7 → ✅.

**Next: S-8 — content turn-in pipeline, part 1.** Tokenized submission portal
for speaker decks + sponsor deliverables, versioned uploads (v1…vN kept),
comment/review cycle per version, technical validation rules-as-data with a
plain-language fix list. Per D-012, S-7's `Speaker.state`/consent fields and
`src/bureau/consent.ts` are already in place — the portal is per-speaker and
should key off `content_complete`'s guard as the thing a validated deck
eventually satisfies. Model: Opus plans, Sonnet builds (D-005's split), same
as every prior item.
