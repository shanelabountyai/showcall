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

## D-006 · 2026-09-21 · Cue times derive; only anchors are stored

A cue is fixed (`day` + `startMin`) or anchored to a session or cue edge plus
an offset, with an optional end-by anchor for slack. No derived time is ever
written, so nothing can drift from its anchor. The run sheet pins the agenda
version it resolves against (`Event.runSheetVersion`, one pin per event — the
agenda is versioned per event). A change is `rebase` and/or cue edits; preview
is the same transaction rolled back, and commit refuses on any problem or if
it would move anything other than what the preview showed. So the stored
graph is always clean against its pin, and a rebase that compresses a cue has
to land together with the edit that fixes it.

Compression is modelled as end-by (fixed duration, deadline, slack), not as a
stretchable cue between two anchors. Add a min-duration stretch cue if
producers ask for "cocktails fill the gap".

## D-007 · 2026-09-21 · The public snapshot carries session ids

Cues anchor to sessions as published, so `PublicSession` gained an opaque
`id`. It is a cuid and reveals nothing; it was added to the projection
deliberately, as the projection's own comment requires.

## D-008 · 2026-09-21 · Call-sheet audiences are roles; cues are tagged

Shane's pick. Each event has named `CallRole`s ("Florist", "A1 Audio") that carry
report-to text, and cues are tagged to them many-to-many (`CueRole`). A role's
sheet is exactly its tagged cues, projected to label, room, day and times.
A table rather than a tag array on the cue, because a typo would otherwise
invent a role, and report-to needs somewhere to live. A role rather than a
person, because people are S-5's staffing model.

- **Call time** is the day's first cue, so it cascades. To call a role
  earlier, add a load-in cue.
- **Speakers get no sheet yet.** The published snapshot names speakers but has
  no ids. That comes with the speaker portal (P0-3).
- **No PDF route.** Issues and PDFs exist as functions. Tokenised delivery is
  P1-3, and an unauthenticated per-role URL would be its own disclosure.
- **PDF** uses the house renderer lifted from rental business (pdf-lib, tagged,
  Helvetica/WinAnsi). A label outside WinAnsi, such as an emoji, fails to render.

## D-009 · 2026-09-21 · A call sheet is stale by content, not by version number

Each issue records the agenda version its run sheet was pinned to. A sheet is
**stale** when the run sheet is behind the agenda (nothing can be trusted
until the rebase) or when its projection no longer matches the last issue.
Strictly comparing version numbers would flag the florist's sheet forever
after a keynote move that never touched it, and re-issuing it to clear the
flag breaks "re-issue exactly the affected sheets". Issuing is refused while
the run sheet is stale, and an unchanged sheet is never re-issued.

## D-010 · 2026-09-21 · The running offset derives from an append-only GO log

Shane's pick. The stage manager calls GO on a run-sheet row, which appends a
`LiveMark` (row, room, planned start, actual minute from the clock). Nothing
stores an offset. Per room, for today only, the offset is the latest GO's
actual minus planned start. Once the next row is overdue, it rises to now
minus that row's planned start, so a cue that has not gone yet is at least
that late. Projected time is planned + offset for every row after the current
one. No cue is ever written, so live mode cannot move the run sheet or the
call sheets built from it.

- **A wrong GO is corrected by the next GO**, because the latest one wins. The
  log keeps both, which is the planned-vs-actual record P1-5 needs.
- **Offsets are per room**, because tracks run independently. The offset does
  not propagate across rooms or through anchors, and slack does not absorb it.
  Add absorption if SMs ask for "lunch soaks up the overrun".
- **No auth on GO.** The app has no users yet. Day-of roles arrive with S-5
  staffing, and GO should be gated to the SM there.
