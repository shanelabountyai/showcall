# Next

**S-10 — chase dashboard.** See `docs/backlog.md` S-10: turn-in deadlines
derived from show date minus lead time, reminder outbox, escalation worklist,
bureau missing-item flags (no headshot, unsigned, deck not approved — the
guard's own messages via `contentMissing`/`nextStepBlocked`) and the lifecycle
funnel rolled in. Recommend Sonnet for the build: routine derived views over
existing guards.

Carry-overs from S-9:
- **The local dev DB still needs a reset** (checksum mismatch on
  `speaker_bureau`; `content_pipeline` and `show_file_lock` not applied).
  Prisma refuses an AI-run reset without Shane's explicit consent. Run it
  yourself: `npx prisma migrate reset --force && npm run db:seed`.
- Stale packages flag, never auto-rebuild (D-016). S-10's worklist can surface
  "package stale" beside the missing items.
- The browser path for override (v7 after lock → reason → revalidate →
  rebuild) is unit-tested only; the S-11 capstone e2e is where it lands.
