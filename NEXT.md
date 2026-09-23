# Next

**S-17 — Branch execution (P0-7, part 2).** See `docs/backlog.md` Phase 4 and D-022. Recommend Opus:
it extends the cascade's preview-equals-commit check.

What S-17 inherits from S-16:
- Plans, branches (`cueEdits` as `BranchEdit[]`), notices and the `ContingencyDecision` table exist; nothing writes a decision yet.
- `BranchEdit` carries `roomId`, but `commitCascade` ignores it and `diffTimings` cannot see a room move. Teach both before executing,
  or the rain branch's room move slips past the preview check.
- The seeded rain call (`prisma/seed.ts`) is the fixture: the rain branch moves "Closing reception" (tagged Catering + Doors & Registration)
  into Ballroom A at 17:30, so exactly those two call sheets should re-issue and A1 Audio should not.
- The cost delta posts through `addLine(…, tx)`; it is non-negative by check constraint.

State: S-16 shipped. 171 vitest tests pass; e2e was 20 passed in the full sweep, plus the new S-16 spec passing on a rerun after a locator fix.
