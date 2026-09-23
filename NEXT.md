# Next

**S-19 — Phase 4 gate, the capstone.** See `docs/backlog.md` Phase 4. e2e on a production build, running the PRD's
five-minute story: v7 after lock, the keynote moves 15 minutes, and the rain call executes at its decide-by cue. Model pick:
Opus. This is a gate, and it crosses every cascade path.

What S-19 inherits from S-18:
- Venue rules are cascade problems (D-024). A rebase or branch that breaks dock hours, bays or a room's rigging/power/trim is refused like a compression.
- The live page's stale warning has **Rebase and re-issue call sheets**. The e2e rain spec clicks it first, because the keynote story leaves the sheet on v1.
- The seeded AV load-out is anchored to the reception, so the rain call moves it 19:00–22:00 → 19:30–22:30, and the preview shows it.
- The full sweep, not a subset, is the gate. CI runs no e2e. S-17's rain spec was green only when run alone.
- The e2e sweep still executes the seeded rain call, so the capstone must run before that spec or re-seed.

State: S-18 shipped (D-024). 187 vitest tests pass; the full e2e sweep passes 25/25 against a production build.
