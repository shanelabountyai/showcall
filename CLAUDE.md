# Showcall — working conventions

Corporate event production operations for "Showcall Productions" (synthetic
data only). Spec: `prd-showcall-event-production.md`. Decisions:
`docs/decisions.md`, which outranks the PRD where they differ. Backlog and
phase gates: `docs/backlog.md`.

## Hard rules

1. **The agenda is the single source.** Run sheets, call sheets and show
   files are derived; each records the agenda version it was built from, and
   stale means that number is behind `currentAgendaVersion`. Derived artifacts
   flag stale — they never silently drift. Call sheets are stale by content
   (D-009): the run sheet is behind, or the projection differs from the last issue.
2. **Published agenda versions are append-only** (database trigger). Publish
   is refused while the grid has conflicts, with every conflict named.
3. **Times are minute-of-day on a `LocalDate`** in the event's timezone
   (`src/time.ts`). "Now" comes from the injected clock (`src/clock.ts`); no
   bare `new Date()`.
4. **Money is integer cents.** Never a float.
5. **Locked show files are immutable; overrides are logged events.**
6. **Consent gates are structural** — no code path distributes an unreleased asset.
7. **Call-sheet filtering is tested by sweep, not trust.** Public and per-role
   views are explicit projections; add fields there deliberately.

## Local environment

- Port **4000**, set in `package.json`.
- Postgres is local, always — `showcall_dev`, `showcall_test`, `showcall_shadow`.
  `DATABASE_URL` carries `?connection_limit=10&pool_timeout=20`.
- `npm test` runs typecheck, then vitest against `.env.test`.

## Write-up

`WRITEUP.md` is maintained as the project goes. Each core artifact gets an
entry when it lands, and every producer-review feature gets a verdict:
validated, changed, or cut — this repo is the event-tools research artifact.
