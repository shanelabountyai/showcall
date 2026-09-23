# Next

**S-18 — Venue profiles (P0-8 rest).** See `docs/backlog.md` Phase 4. Dock, power, rigging, ceiling, wifi and union
house rules as structured data; load-in and load-out slots planned against them as production cues. Model pick: Sonnet
for the profile data and CRUD, Opus if slot planning ends up refusing cues (that is cascade-correctness work).

What S-18 inherits from S-17:
- `commitCascade(…, also)` runs extra writes in the cascade's transaction, after the preview check. Use it for anything that must land with a cue edit.
- `CueEdit` takes `roomId`, and every `Moved` span carries its room name. A load-in cue moved between rooms shows in the preview.
- The e2e sweep executes the seeded rain call, so S-19's capstone must either run before that spec or re-seed.

State: S-17 shipped (D-023). 176 vitest tests pass; both contingency e2e specs pass against a production build.
