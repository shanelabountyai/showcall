# Showcall — write-up

The event-tools research artifact: every producer-review feature that
survives contact with the build becomes a validated requirement for the
product line. Verdicts are logged as each lands.

## Agenda conflict engine (P0-1)

**Problem.** A multi-track agenda breaks three ways: two sessions in one
room, too little time to strike and reset a room between sessions, and one
speaker booked in two rooms at once. A spreadsheet catches none of them.

**What it does.** `detectConflicts` is a pure function over the grid that
returns every conflict with both sessions and a sentence a producer can act
on ("Ballroom A needs 15 min turnover Tue, Oct 13 between … has 10").
Publishing runs it and refuses on any hit; a clean publish writes an
append-only version holding only the public projection.

**What it deliberately does not do.** Walking time between rooms, sessions
past midnight, auto-resolution. It names conflicts; people fix them.

**Verdict — producer review #4 (agenda as the spine): validated.** Turnover
as per-room data was a one-line addition to the engine and catches the
conflict spreadsheets miss most.

## Cue graph and cascade (P0-2, run sheet)

**Problem.** A run sheet is a web of "because": doors are 30 minutes before
the keynote, the reset starts when strike ends and has to be done before the
panel. Move the keynote 15 minutes in a spreadsheet and someone retypes every
dependent time, and the one they miss is the one that breaks on show day.

**What it does.** Cues store anchors, never times: `resolveCues` is a pure
function that derives every cue from its chain and names four problems —
anchor loops, anchors cut from the agenda, cues pushed off the day, and
impossible compression (a cue that can no longer finish by its end-by, with
the minutes short). The run sheet records the agenda version it was built
from; a new publish makes it stale. Rebasing previews the whole cascade
(every session and cue that moves, from → to) and commits it atomically,
refusing any change that leaves a problem or that no longer matches what was
previewed. A compression and the fix for it commit as one change.

**What it deliberately does not do.** Stretch cues that fill a gap, walking
or crew-rule constraints (P1-1), auto-resolving a compression, a run-sheet
UI (S-4's live mode is the first screen that reads it).

**Verdict.** Not a producer-review feature on its own; it is the substrate for
the "keynote moves 15 minutes" capstone and for call sheets (S-3).

## Role-filtered call sheets (P0-2)

**Problem.** Everyone on a show needs their own slice of the run sheet: the
florist needs load-in and strike, audio needs walk-in music and the toast.
Producers either send everyone the full run of show, which puts the toast order
in the florist's inbox, or hand-cut a sheet per vendor that goes stale the
moment the keynote moves.

**What it does.** Cues are tagged to roles. Each role's sheet is an explicit
projection of the run sheet: its own cues, with label, room, day and times only.
No sessions, anchors, slack, speakers or other roles' cues. Issues are
versioned and append-only. Issuing re-sends only the roles whose sheet changed,
each with a changed-since-last-issue diff (added, removed, moved, report-to).
It refuses while the run sheet is behind the agenda. The PDF is regenerated
from the stored issue, so what a role was sent is kept exactly. A sweep
checks every role's issue and PDF text against every string that belongs to
anyone else. It was proven by two deliberate leaks, both caught.

**What it deliberately does not do.** Speaker sheets (P0-3), delivery and
receipt confirmation (P1-3's tokenised portal), per-person sheets (S-5
staffing), venue dock data (P1 venue profiles). Report-to is free text for now.

**Verdict — producer review ("the florist never sees the toast order"):
validated, with one change.** The per-role filter held as written. The change
is to staleness: a version-number rule would re-issue sheets that did not
change, so a sheet is stale by content (D-009). The keynote-moves-15 fixture
re-issues exactly audio and the stage manager.

## Stage-manager live mode (P0-2)

**Problem.** On show day, the run sheet is a plan, and the room is always a
few minutes off it. The stage manager needs to know what is up now, what is
next, and when the next thing will actually happen. They need that without
editing the plan, because editing it re-cascades and re-issues every call sheet.

**What it does.** `/events/:id/live` shows each room's current and next row
and how late or early the room is running, with a projected time beside every
planned one. It polls every five seconds. GO on a row appends a mark stamped
from the server clock. The offset derives from the latest mark, and from the
clock once the next row is overdue (D-010). The run sheet and cues are never
written, and a test asserts the run sheet is identical before and after a GO.

**What it deliberately does not do.** Slack absorbing an overrun, offsets
crossing rooms, auth on GO (S-5 day-of roles), push updates (polling is the
spec), or the planned-vs-actual report (P1-5, which reads this log).

**Verdict — producer review ("running late propagates to projected times"):
validated, with one change.** Instead of a hand-set offset, the stage manager
calls GO and the offset derives from it, so a hand-set number cannot go stale.
The overdue rule means a room that has not called GO still shows as late.

## Supporting spine: events, staffing, grid editing (P0-8 basics)

**Problem.** Phase 1 needs a show to run: an event under a client, people
assigned to it for the day, a way to edit the agenda without writing SQL, and
a conference big enough to show the whole system working. Live mode also
needed an answer to "who is allowed to call GO?"

**What it does.** Events are created under a client, which is matched by name
and created if new. The draft grid page edits sessions freely, lists every
conflict, and publishes only when the grid is clean. It refuses only what
cannot belong to the event at all: another event's room or speaker, or a day
outside the event. Staffing assigns day-of roles (producer, stage manager,
technical director, crew) to a room or event-wide. A booking is refused when
it overlaps the person's other shifts, or runs them past their daily cap,
counted across every event. GO is refused for anyone who is not the room's
stage manager that day (D-011). `npm run db:seed` builds the Northwind
Leadership Summit: two days, three tracks, 28 sessions, cues tagged to three
call roles with sheets issued, eight staff, and GO marks for every row already
due today. Day 1 is always today, so live mode is mid-show.

**What it deliberately does not do.** Login (D-011: identity is picked, not
proven). Capacity overrides. Editing rooms, speakers or staff in the UI (the
seed provides them). Registration, budget, vendor compliance and venue
profiles, which are the rest of P0-8 and belong to later phases.

**Verdict — Groundwork crew model reuse: validated, with one change.**
Overlap and daily-cap checks carried over as written, and so did the row lock
that makes two concurrent bookings of the same person serialize. The change
is that capacity is counted per person across events, not per event, so a
technician on two shows the same day is caught.

## Phase 1 gate: e2e and the demo story (S-6)

**Problem.** Grid edit/publish, staffing refusals and gated GO (S-5) had unit
coverage only — nothing had opened a browser. And the "keynote moves 15
minutes" story (P0-2's capstone) has no UI for half of it: cascade
preview/commit and call-sheet issuing are deliberately backend-only (P0-2's
write-up), so the story can't be driven end-to-end from the browser alone.

**What it does.** `playwright.config.ts` builds and serves a production
build on :4000 against `.env.test` (`npm run test:e2e`, with `E2E_DEV=1` as a
dev-server escape hatch for debugging one spec). One spec, run in order
against the seeded Northwind Summit: the grid is clean and published;
overlapping a session blocks publish with the conflict named, and reverting
clears it; moving the keynote 15 minutes stays clean and publishes v2, which
leaves live mode's staleness banner correctly lit for the next block; a
staffing booking past a person's daily cap is refused, named, and one within
it succeeds; GO is gated to the room's own on-duty stage manager (D-011) and
recording it flips that row's state. `scripts/demo.ts` (`npm run demo`) is
the other half: it moves the seeded keynote 15 minutes through the same
`saveSession`/`publishAgenda` path the grid UI uses, then previews and
commits the cascade and issues call sheets, narrating exactly what moves and
which roles' sheets actually change — the backend half of the capstone,
runnable and readable on its own.

**What it deliberately does not do.** A UI for cascade preview/commit or
call-sheet issuing (still P0-2's call); CI wiring (the sweep runs locally for
now).

**Verdict.** Not a producer-review feature; it is the Phase 1 gate. Passing:
55 vitest tests, 8 e2e specs against a production build, and the demo script
against the seeded summit, all green.

## Speaker bureau (P0-4)

**Problem.** A speaker moves through a real lifecycle — invited, confirmed,
contracted, content turned in, rehearsed, showed, released for post-show
distribution — and each step depends on data actually existing: no honorarium
and signed contract, no business calling them contracted. Skip the checks and
the state column is a label a producer can set to anything, which is worse
than no tracking at all. Phase 2's pipeline (S-8/S-9) also needs an answer,
before it exists, to "may this asset leave" — get that wrong once and an
unreleased recording ships.

**What it does.** `advance()` moves a speaker forward one state at a time,
refused with the guard's own reason if the state isn't earned yet
(`contracted` needs an honorarium and a signed contract; `content_complete` a
bio; `rehearsed` a booked rehearsal slot; `showed` a real agenda session;
`released` consent *recorded*, not that every flag is yes). `revert()` is a
separate, deliberately unguarded path for a producer's correction: backwards
only, a reason required, logged the same as a forward move. Every transition
— forward or back — appends to `SpeakerTransition`, append-only like
`AgendaVersion` and `LiveMark`. Rehearsals reuse P0-1's conflict engine
outright: a rehearsal is a `Session` with `isRehearsal: true`, so room,
turnover and speaker conflicts are checked identically and a double-booked
rehearsal blocks publish, named like any other conflict — it is simply
excluded from the public snapshot. `src/bureau/consent.ts` is the structural
gate hard rule 6 requires (Quorum's discipline, per the PRD): a filter, not a
boolean, so a caller gets back only what may release plus why each held-back
item was held, and an unrecorded consent withholds everything regardless of
the three flags. Proven with a no-path sweep over every flag combination ×
asset kind × recorded/unrecorded before S-9 has anything real to gate.

**What it deliberately does not do.** The `by` column on `SpeakerTransition`
— there is still no user to name (same gap D-011 closed for GO, minus the
`?as=` picker). Deck/headshot validation (`headshotUrl` and the
`content_complete` guard are S-8's to extend). A UI to browse the transition
log beyond a per-speaker `<details>`.

**Verdict — producer review #1 ("Quorum's structural-gate discipline"):
validated, with one change.** The no-path sweep held as written: consent
unrecorded withholds every kind regardless of flags. The change from a plain
boolean gate to a filter (`releasable()`) was made before S-9 exists, on the
bet that a filter is harder to bypass by accident than a boolean callers must
remember to check at every call site — S-9 will confirm or correct that bet
when it's the one calling it.

## Content turn-in, part 1 (P0-5, S-8)

**Problem.** Decks and sponsor files arrive by email, in whatever shape the
sender had: 4:3 slides for a 16:9 screen, fonts that fall back to Arial on
the show laptop, a 300-pixel logo for a stage banner. The producer finds out
at rehearsal. Every fix is another email, and nobody knows which attachment is
the current one.

**What it does.** Each speaker and sponsor gets a portal link. The database
holds only the link token's SHA-256, and reissuing the link kills the old one.
Every upload is a new version, v1…vN, all kept (append-only trigger). Numbers
stay dense even under concurrent uploads (`SELECT … FOR UPDATE` on the
deliverable). Facts come from the file's bytes, not from its name or claimed
type (`src/content/facts.ts`, no new dependency): PDF page aspect and embedded
fonts via pdf-lib, PNG/JPEG pixel size from the headers, MP4 video codecs from
the sample-description box. A hostile or truncated file never throws; the fact
just stays unknown. The event's rules are data (`ValidationRule`), and a pure
`evaluate()` checks the facts against them. Each failure carries its own
plain-language fix, shown to the submitter under the version. An unknown fact
is *needs review*, never a pass. Each version keeps its validation run and a
two-sided comment thread (producer / submitter, "requests changes"), all
append-only. The trust boundary lives in `submitVersion` and
`submitterComment`, not the page: speaker A's link cannot write to B's
deliverable or a sponsor's, and a refused write leaves nothing behind. Bad
rule parameters are refused when the rule is added, so a producer typo can't
break every later upload of that kind. The bureau's `content_complete` now
needs a bio **and** every deck's latest version passing validation (D-015). A
passing v1 doesn't count if v2 failed.

**What it deliberately does not do.** Approve/lock/override and distribution
(S-9). Deadlines, reminders and missing-item flags (S-10). PPTX internals:
a .pptx deck's fonts and aspect show as *needs review*. Fonts used only inside
PDF form XObjects are not seen (marked `ponytail:` in facts.ts). No auth on
the producer side, same as the rest of the app so far.

**Defect found while building.** The plan's default deck rules included a
`manual` brand-template check, which by design always returns *needs review*.
With it on decks, no deck could ever pass, so `content_complete` would have
been unreachable until S-9 ships approval. The seed puts that manual check on
sponsor banners instead (D-015 addendum).

**Verdict — producer review ("rules as data with a plain-language fix
list"): validated.** The fix text lives on the rule, so the fix list is
whatever the producer wrote, not engineer phrasing. The seeded fixes read as
instructions ("Embed your fonts when exporting (PowerPoint: File → Options →
Save …)"), not error codes. The e2e story is a speaker uploading a deck,
seeing "Fix: Embed your fonts" and "Fonts not embedded: Helvetica", and v2
passing. That's the loop the feature exists for. One change: the evaluator
needed a third status (*review*) beside pass/fail. Two states would have
forced a guess on every fact the extractor can't read.
