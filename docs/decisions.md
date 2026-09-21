# Decisions

Outranks the PRD where they differ.

## D-001 · 2026-09-21 · Reuse at session 0

`reuse-scan.py find` for anchor / run sheet / call sheet / cascade / conflict /
turnover / dependency. **No donor for the cue engine** — the PRD's "Knotwork
scheduler" does not exist on disk, and event-toolkit's logistics package only
labels a run-of-show section. Lifted from **groundwork**: `src/clock.ts`,
`src/money.ts`, `src/db.ts` + `prisma.config.ts` (cloud-DB guard),
test harness `resetDb`, vitest config, script layout, `vercel.json`
ignoreCommand. Groundwork governs those if the two diverge.

## D-002 · 2026-09-21 · Time is minute-of-day on a local date

Sessions and cues store `day` (Postgres `date`) + `startMin`/`endMin`. A show
runs on the venue's wall clock; instants would let a server timezone or DST
move a cue. Sessions end by midnight (check constraint) — a gala past 00:00
is a known ceiling, not yet a requirement.

## D-003 · 2026-09-21 · Stale is derived, not flagged

The PRD says agenda changes "flag downstream artifacts stale". Instead of a
flag column that every write must remember to set, each derived artifact
stores the agenda version it was built from; stale = behind the current
version. Nothing can forget to set it.

## D-004 · 2026-09-21 · Turnover is strike + reset, per room

Two integer columns on `Room`. A gap of exactly strike + reset passes.
Speaker conflicts are overlap only — back-to-back in different rooms is
allowed; walking time between rooms is the producer's call.

## D-005 · 2026-09-21 · Model per item

Phase 1 runs on `opusplan` (Shane's pick): Opus plans the engines, Sonnet
builds.
