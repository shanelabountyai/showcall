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
