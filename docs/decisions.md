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

## D-011 · 2026-09-21 · GO is gated to the room's stage manager by assignment, not by login

Closes D-010's "no auth on GO". A GO names who called it (`LiveMark.staffId`),
and `markGo` refuses anyone without a `stage_manager` assignment for this
event, today, on that room or event-wide (a null room is a show caller over
every room). The check is on the day, not the shift window, so a GO a few
minutes past a shift's end is not refused mid-show.

- **This is not authentication.** The app still has no users. `?as=` on the
  live page picks who is calling from today's on-duty stage managers, and GO
  shows only in that person's rooms. The gate is structural: no code path
  logs a GO for someone who is not on duty for the room. A login binds the
  identity when the app gets users, and the check stays the same.
- **Capacity belongs to the person, across events** (Groundwork's crew-day
  cap). Overlaps and minutes past `maxMinutesPerDay` are refused and named.
  There is no override. Groundwork logs capacity overrides, and one gets added
  here if producers ask to book someone past their cap on purpose.

## D-012 · 2026-09-21 · Phase 2 items run bureau before pipeline, against the PRD's own numbering

The PRD lists P0-3 (pipeline) before P0-4 (bureau), but the pipeline's
tokenized portal is per-speaker and its distribution builder must check
consent before packaging an asset — both need the bureau's `Speaker`
lifecycle/consent fields to already exist. Phase 2 is scoped as S-7 (bureau:
lifecycle, profile/AV/honorarium, rehearsal slots, consent flags as a gate
function with its own no-path unit test) → S-8 (portal, versioning,
validation rules) → S-9 (lock, override, distribution builder — calls S-7's
gate) → S-10 (chase dashboard, unifying both) → S-11 (gate: e2e + demo).

This keeps CLAUDE.md's hard rule #6 ("no code path distributes an unreleased
asset") true from the moment distribution exists, rather than bolted on
after S-9 ships. It also matches the Build Notes' TDD order — conflict
engine → cascade → validation rules → consent no-path test — since the
*fixture* proving the gate holds end-to-end lands with S-9, even though the
gate function itself is written and unit-tested in S-7.

## D-013 · 2026-09-22 · A rehearsal is a session; its conflicts block publish like any other

`src/agenda/conflicts.ts` already anticipated this (P0-1's docstring). A
rehearsal is a `Session` with `isRehearsal: true` — same room/turnover/speaker
conflict checks, same draft-is-free-to-conflict rule. `loadGrid` returns every
session, rehearsals included, so `detectConflicts` sees the whole picture and
a double-booked rehearsal blocks publish, named like any other conflict. The
only change at publish is the public snapshot: `publishAgenda` filters
`isRehearsal` sessions out of what it writes to `AgendaVersion.snapshot`, so
rehearsals never reach the public agenda, call sheets, or (per D-006) a cue
anchor that survives a rebase. One rule ("a clean grid publishes"), not two.

## D-014 · 2026-09-22 · Speaker lifecycle: guarded transitions plus a logged step-back; consent is a filter

Shane's pick, for S-7. `advance()` moves one step at a time and is refused,
naming the reason, unless the step's guard is satisfied (`contracted` needs
an honorarium and a signed contract; `content_complete` needs a bio;
`rehearsed` needs a rehearsal session booked; `showed` needs a real agenda
session; `released` needs consent *recorded*, not that every flag is yes). A
producer's correction is a separate function, `revert()`: it goes backwards
only, requires a reason, and does not re-run the guards — the correction is
what fixes a wrong one, so it cannot be blocked by the guard it is fixing.
Every move, forward or back, appends to `SpeakerTransition` (append-only,
like `AgendaVersion` and `LiveMark`); there is no `by` column yet — the app
still has no users, same as D-011's GO log before staffing existed.

`src/bureau/consent.ts` gates hard rule 6 as a **filter**, matching
`projectCallSheet`'s shape (D-008): callers get back only what may release,
plus why each held-back item was held. `consentRecordedAt == null` withholds
every asset kind regardless of the three flags — an unanswered speaker is not
a "no", but it is not a "yes" either, and the gate treats it as neither.

## D-015 · 2026-09-22 · Content turn-in: real file inspection with honest gaps; a validated deck gates content_complete

Shane's picks, for S-8.

**Facts come from the file, not the uploader.** A pure extractor reads what it
can with no new dependency: byte size and sniffed type for everything; PDF
page aspect ratio and embedded fonts via pdf-lib (already installed); PNG/JPEG
pixel dimensions from header bytes; MP4/MOV codec from the sample-description
box. A rule whose fact could not be read (PPTX fonts, brand-template fit)
returns **needs review** — never a pass. A version's validation is
failed > needs review > passed; only *passed* counts as validated.

**Rules are data, per event**, keyed to a deliverable kind; the evaluator is a
pure function over (facts, rules), and every failure carries its own
plain-language fix. Results are stored per version, append-only, so S-9's
re-validation on override is a new run beside the old one, not an overwrite.

**`content_complete` now needs a bio and a latest deck version that passed
validation** (D-014's guard, tightened). S-9 tightens it once more, to
"approved and locked", when lock exists — deliberately two edits rather than
leaving the guard meaningless for an item.

Defaults taken without asking (reversible): file bytes live in Postgres
(`bytea`) with a stored SHA-256 — local, transactional, and S-9's checksummed
manifest reads the hash rather than re-hashing; portal tokens are random,
stored only as a SHA-256 hash, one per speaker and one per sponsor, revocable
by reissue; comments have an author side (producer/submitter) and no `by`,
same as D-014.

**Addendum (S-8 build).** The brand-template `manual` check is seeded on
sponsor banners, not decks. `manual` always returns *needs review*, and only
*passed* validates a deck, so on decks it would make `content_complete`
unreachable until S-9's approval exists. S-9 can move it back once an
approval resolves a review. Also: with several deck deliverables, the guard
requires *every* deck's latest version to have passed, not just the most
recent upload.
