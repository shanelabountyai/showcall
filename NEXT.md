# Next

**S-9 — content turn-in pipeline, part 2.** Needs planning first (Opus).
See `docs/backlog.md` S-9: approve → show-file lock (immutable), late-revision
override (logged, re-validates as a new `ValidationRun`), per-room
distribution builder (checksummed manifest from `ContentVersion.sha256`,
running order from the agenda, consent via `releasable()`), and a stale-package
flag that clears only on rebuild.

Carry-overs from S-8:
- Tighten `content_complete` to "approved and locked" (D-015 says S-9 does this).
- An approval resolves *needs review*, so the brand-template `manual` rule can
  move back onto decks (D-015 addendum).
- The local dev DB has a checksum mismatch on `speaker_bureau`, so
  `prisma migrate dev` wants a reset. `content_pipeline` is not applied to dev
  yet. Fix: `npx prisma migrate reset` (dev is seeded synthetic data), then
  `npm run db:seed`.
