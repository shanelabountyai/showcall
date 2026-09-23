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

## Content turn-in, part 2: lock, override, packages (P0-5, S-9)

**Problem.** At 11pm the night before, a speaker sends v7. The playback
operator in Salon B has v6 on the show laptop, and the producer thinks v5 got
approved. Nobody can say which file is the show file, whether v7 was ever
checked, or whether the room's playback folder matches the agenda after this
afternoon's keynote move. And after the show, the "send everyone the decks"
email goes out with a deck in it from a speaker who said no.

**What it does.** Approving a version locks it as the show file. `ShowFileLock`
is an append-only pointer, and its highest-numbered row wins. Lock 1 is the
approve: latest version only, never a failed one, and it resolves *needs
review*. So the brand-template `manual` rule goes back onto decks. Every later
lock is an **override**: it needs a reason, and it re-runs the event's
*current* rules as a new validation run. A failed run refuses the override,
but the run stays in the log with its fix list. A database CHECK makes the
approve/override shape structural, and a trigger refuses a lock that points
at another deliverable's version. Portal uploads after lock are accepted as
versions but never move the pointer. `content_complete` now needs every deck
approved and locked.

Distribution builds two kinds of package (`src/content/distribution.ts`). A
**room** package is that room's playback set in running order from the
published agenda: each speaker's locked decks and videos, with every item not
locked yet named as a gap. An **attendees** package is the post-show deck
bundle, and every entry passes the bureau's `releasable()` gate first. A
withheld deck isn't in the manifest at all, and the producer sees why. Each
build is append-only, with a SHA-256 over the manifest's canonical JSON. A
package is **stale when the manifest built now would have a different
checksum**. The page shows what was added and removed. Only a rebuild clears
the flag, and an unchanged package is refused a rebuild.

**What it deliberately does not do.** No automatic rebuild: the stale flag is
the signal, and a silent rebuild would hide what changed. No file transfer.
A package is a checksummed manifest, not a zip on the playback laptop, and
there's no attendee delivery channel (P1-2). Sponsor files have no room, so
they're in neither package. The capstone "v7 after lock" demo is S-11's.

**Defects found while building.**
- *Draft edits reaching a package.* The first builder took each session's
  speakers from the draft grid, filtered by the names in the published
  snapshot. Removing a speaker in the draft pulled their deck from the
  package before anything was published. The test "a draft speaker change
  doesn't reach the package until it's published" caught it. The fix was to
  make the snapshot carry opaque `speakerIds`, as D-007 did for sessions, so
  a package follows the agenda as published. The projection test's
  exact-keys assertion then refused the new field until it was added on
  purpose, which is what that assertion is there for.
- *Ties under a fixed clock.* Ordering locks by timestamp is ambiguous when
  two land in the same millisecond. That always happens under the test clock,
  and can happen in real life. Locks got a dense `number` instead, which also
  made "lock 1 is the approve" a one-line CHECK.

**Verdict — producer review ("the cutoff-with-override rule, exactly"):
validated.** The override is the cutoff: nothing reaches the show file after
approval without a named reason in an append-only log, and the late file is
re-checked against today's rules, not the ones it was uploaded under. One
change: a failed re-check refuses the override (Shane's pick) instead of
logging it and landing anyway.

**Verdict — "distribution builder, regenerated when the agenda or a locked
file changes, stale until rebuilt": changed.** It's stale-by-content, like
call sheets (D-009): a keynote move flags Ballroom A and leaves Salon B
current. It flags rather than regenerates, because at 11pm the producer needs
to *see* that Salon B changed before its laptop does. The PRD's single
builder also became two packages. Playback plays a presenter's own deck in
their own session and isn't gated. The attendee bundle is where consent
belongs, and its no-path sweep (all 8 consent combinations plus unrecorded)
landed with it (D-016).

## Chase dashboard (P0-5, S-10)

**Problem.** A producer's real question a month out is not "what has arrived"
but "who is late, and by how much". That answer lives in four places at once —
a spreadsheet of decks, the sponsor thread, the contract folder, the bureau's
own lifecycle — and none of them knows the show date. The lead time is the
part people get wrong: a deck is not due on show day, it is due early enough
to clear validation *and* a rehearsal, and when the rehearsal moves, the
deadline everyone wrote down does not.

**What it does.** One board, sorted worst-first, over deliverables that
already exist. Each row's deadline is derived, never stored: the owner's first
call minus the event's lead time for that kind. "First call" is the owner's
earliest session with rehearsals included, so the rehearsal lead the PRD asks
for falls out of D-013's "a rehearsal is a session" rather than being coded
twice — and moving a session moves the deadline with it. Lead times are data
per event and kind (`DeadlinePolicy`), and a kind with no policy reads "no
lead time set" instead of inheriting a constant: a fabricated deadline is
worse than an absent one, because a producer chases against it.

The reminder cadence — 14, 7, 3, 0, −3, −7 days — is enforced by a unique key
on `(deliverableId, step)` rather than by scheduling code, so a step cannot be
sent twice however often the button is clicked, with no dedupe logic and no
lock. `cadenceStep()` returns the most urgent step *reached*, which means a
skipped step never fires retroactively: a board opened for the first time a
week late sends one reminder, not the four it "missed". The outbox row is the
send — append-only, body rendered once at send time and kept as sent, so it
can never be re-rendered against a deadline that has since moved.

The bureau roll-up reuses the lifecycle's own machinery rather than forming a
second opinion: `missingItems()` is a superset of `contentMissing()`, and the
"next step blocked" line is `nextStepBlocked()` — the same guard table
`advance()` enforces. The board cannot disagree with the lifecycle about
whether a deck is approved. Stale distribution packages ride along from
`packageStatus()` (D-016) with a link to rebuild, never an automatic one.

**Hardest bug — the board could not see who was actually late.** The first
render looked right and was quietly useless: eight rows, four sponsor items
and four *locked* decks. Every speaker genuinely behind on a deck was absent
from the escalation worklist entirely, showing up only in the missing-items
list. The cause was upstream of the dashboard — the seed created a deck
deliverable only for speakers already past `content_complete`, so the people
being chased had nothing to chase. The tempting fix was to synthesise phantom
rows in the board for speakers with no deliverable. That is the wrong answer:
a deliverable is the record that something was asked for, and inventing one
means the board asserts a debt nobody incurred. The fix went into the seed —
every booked speaker owes a `Session deck` from the moment they are booked —
and the board's rule stayed honest: it chases what exists. That change then
broke an e2e spec (two deck deliverables meant two `Upload` buttons and a
strict-mode violation), which is the right kind of breakage: the fixture told
the truth about the product change.

**Defects found.** The seed's own chase pass consumed the current cadence
step, leaving the demo's "send due reminders" button dead at (0) with a full
outbox. Fixed by running the seed's pass on a clock 28 days back — the
injected clock (hard rule 3) is what made that a one-line change rather than a
fixture rewrite, and the result is a better demo: history in the outbox *and*
a live escalation today.

**What it deliberately does not do.** No mail transport — the outbox row is
the send, and a real one swaps in behind `sendDueReminders`. No per-owner
reminder preferences or quiet hours. No decide-by cues (P1, D-016's phase 4).
No automatic package rebuild, per D-016.

## Phase 2 gate: e2e and the demo story (S-11)

**Problem.** The PRD's content capstone is "the 11pm v7": a speaker whose
deck is already locked sends another one the night before. S-9 built the
override and the package rebuild with unit tests, but no browser had been
through them. A lock that works in unit tests and silently moves when
someone uploads is exactly the failure the capstone exists to catch.

**What it does.** The seed gives Hollis Grant a real history, with v1
failing on fonts, v2–v5 as revisions and v6 locked as the show file. The new
e2e spec then runs the whole story on a production build, like the rest of
the sweep. Ballroom A's playback package starts at Package 1, current, with
v6. The producer reissues Hollis's portal link, and the speaker uploads v7,
which lands as *needs review*. v6 is still the show file and the package is
still current, so a late upload is kept but changes nothing. Asking to
override the lock back to v1 is refused with the fix named ("Embed your
fonts"), because override re-validates against today's rules. That refusal is
now proven in the browser, not just asserted. Overriding to v7 with a reason
lands as `Lock 2: override v7` with the reason in the log. The package goes
stale and names the change: `Removed: … v6`, `Added: … v7`. It stays stale
until the producer clicks rebuild (D-016), then it is Package 2, current,
with v7.

**Defects found.** None in the product. The first draft of the spec was
wrong: it expected the Phase 1 keynote move to leave Ballroom A's package
stale. It doesn't, and that is correct. The moved Day 1 keynote belongs to
Dana Reyes, who is only *invited* and owes no deck. Her session puts nothing
in the manifest, so moving it changes no checksum. Staleness by content
(D-009) did what it should and ignored a change that touches no file.

**What it deliberately does not do.** No automatic rebuild after an override
(D-016). No notice to the room's playback operator that a package changed.
The stale flag on the packages page and the chase board are the signal.

**Verdict.** Producer review asked for "the cutoff-with-override rule,
exactly". **Validated.** Upload after lock never moves the pointer, override
needs a reason and re-validates, and distribution follows only on rebuild.
Gate passing: 124 vitest tests, 14 e2e specs against a production build.

## Budget spine and vendor compliance (P0-8, S-12)

**Problem.** An event budget usually lives in a spreadsheet that someone
re-saves as `v3-FINAL-client`, and the question "what changed since the
client signed off" gets answered by scrolling two copies side by side. Vendor
paperwork lives in an inbox. The failure it causes is specific: the AV
company's certificate of insurance lapses on day one of the show, and nobody
notices until the venue asks for it at the dock.

**What it does.** Budget lines per event and category, in integer cents,
with committed (contracted) and actual (invoiced) amounts and a
client-billable flag. The budget-to-actuals view gives per-category and
overall totals, the variance, and the client-billable split, all from one
`summarize()` function. The same function reads live lines and a snapshot's
frozen ones, so the two can never be added up differently. Snapshots are
append-only and numbered per event. The view shows drift against the latest
one, per category, so "since the client-approved budget, AV is up $1,850"
is a line on the page, not a diff done by hand.

This is the ledger the rest of Phase 3 posts into (D-018): accepted
attrition exposure (S-13), RFP awards (S-14) and contingency cost deltas
(S-17) each become a line here.

Vendors are house-wide, and a vendor ends up on an event's compliance
worklist for one reason: it has a budget line on that event. It then needs
a W-9 on file and a certificate of insurance in force through the event's
last day. As in the chase (D-017), due days are derived, never stored. A
missing document is due at the event's start, and a COI that lapses before
the show is due on its own expiry date. A line whose vendor has outstanding
papers says so next to the money. The nag outbox reuses the chase's cadence
function rather than copying it, and its unique key includes the due day, so
a renewal that still falls short starts a fresh cadence with no reset code.

Dollars typed into the page are parsed to cents with integer arithmetic.
`12.345` is refused by name, not rounded.

**Defects found.** None in the product. Two first drafts of tests were
wrong, and both mistakes confirmed a rule. A unit test expected a renewal
due 16 days out to owe a nag, but the cadence starts at 14 days and never
fires early. An e2e spec located the error message with
`getByRole('alert')`, which also matches Next.js's own empty route
announcer. The older specs had already settled on `p[role="alert"]`.

**What it deliberately does not do.** No document upload yet: a document is
recorded as received with its dates, and vendors upload through the S-21
portal. No approval gate on budget changes (P1-6, S-23). No markup or fee
lines beyond the client-billable flag. No mail transport behind the nag
outbox, the same call as the chase.

**Verdict.** Producer review asked for vendor compliance "with expiry
tracking and nag worklist". **Validated, with one scoping change.** The
worklist is per event and asks only of vendors with money on that event, and
"in force" means through the event's last day rather than as of today. A COI
that is valid now but lapses mid-show is exactly the case that bites.
Gate: 141 vitest tests; the 3 new budget e2e specs pass against a production
build.

## Room-block attrition (P0-5, S-13)

A hotel block is modelled as the contract reads: rooms per night, a nightly
rate, a signing date, a cutoff, and dated thresholds ("80% of contracted
room-nights by D-30, or pay the shortfall at the block rate"). Reservations
come out of the block's per-night inventory, and that includes speaker, staff
and VIP rooms. Each one is dated the day it was booked. Everything else is
derived on read by one pure function, `assess()`: pickup as of each threshold,
the projection at the pace so far, the requirement, and the shortfall in
room-nights and cents.

An open shortfall within 14 days of its threshold becomes an alert, framed as
the decision it is. The seeded example reads "Release 24 room-nights by Sat,
Oct 3 or accept $4,541.00 (19 room-nights short)". The release count is
exact: it is the smallest release that clears the shortfall, and a fixture
proves that one fewer does not. Either answer is an append-only decision. A
release hands rooms back, emptiest nights first. An accept posts the exposure
to the budget against the hotel, in the same transaction, through the S-12
sink. Thresholds net against each other (D-020), so accepting D-60 and then
D-30 puts the worst shortfall on the budget, never the sum. Each decision
carries the figure the producer was looking at, and it is refused if the
numbers have moved since then.

**Defects found.** One, in the first draft of the state logic: a passed
threshold whose shortfall had been accepted read as *met*. It was not met.
It was paid for. The board now has an `accepted` state, and a test covers it.

**What it deliberately does not do.** Cancellations, release caps, partial
releases, and the master-bill cost of the rooms themselves (D-020). The alert
lives on the rooms page and does not go to an outbox, because its audience is
the producer.

**Verdict.** Producer review said "this is where shows lose real money
quietly." **Validated.** The quiet part turned out to be concrete: shortfall
math is simple on the day of the threshold and invisible before it. The pace
projection is what turns it into a decision with a deadline, and framing the
decision in the hotel's own units (room-nights, by a date) is what makes the
release option real rather than theoretical.
Gate: 157 vitest tests; the budget and new attrition e2e specs pass against a
production build.

## RFP normalization (P0-6, S-14)

Each category has a line-item schema, kept as data. Catering, for example, is
breakfast, lunch and the afternoon break per head, service staff priced each,
and linens and delivery flat. An RFP copies its category's schema when it
opens. A quote is entered the way proposals are written: a base price, flat or
per head, and then an answer for every line. The answer is *included* (covered
by the base), *excluded* (a gap), or *extra* at a unit price. No line can be
left blank, so silence is never mistaken for inclusion. The per-head quantity
is the registration headcount, summed across attendee types and read at
compare time, so the comparison moves when registration does.

The comparison is one pure function, `compare()`. It produces each quote's
normalized total, its cost per head, and the inclusion matrix, with gap rows
and excluded cells highlighted. It also marks the *lowest complete* quote,
which is never a quote with a gap. The seeded kickoff RFP shows why that
matters. Harvest Table is cheapest at $18,210, because it leaves out the
afternoon break. Summit Hospitality's flat $20,500 package, with the break
extra at $6 a head, is the lowest complete quote at $22,060. Lakeshore's
"$72 all-inclusive" comes to $22,320 once service staff are added.

An award works like an attrition decision (D-020). It carries the total the
producer saw, and it is refused if that total has moved. The award writes the
budget commitment (through `addLine(…, tx)`) and a `Contract` record in one
transaction, and the RFP then closes. A vendor whose papers lapse is flagged,
not refused (D-021). The contract stores what compliance said at that moment
("certificate of insurance expires Mon, Nov 2, before the show ends"), and the
vendor's new budget line puts it on the S-12 worklist. The awarded quote's
gaps are stored the same way, as "still to source".

**Defects found.** None in the module. A backlog-editing script merged two
table rows while marking S-14 done. It was caught by reading the diff before
commit.

**What it deliberately does not do.** It does not move the commitment when the
headcount changes after award: a guarantee adjustment is a change order. It
also does not handle per-attendee-type quantities, percentage lines (service
charge, gratuity), or proposal PDFs (D-021).

**Verdict.** The PRD's line was "what 'all-inclusive' actually includes, apples
to apples." **Validated.** The three-answer normalization was enough to expose
both classic traps in one seeded RFP: an all-inclusive price that was not
all-inclusive, and a cheapest quote that was cheap by omission. Requiring an
answer on every line did the most work, because it turns "they didn't mention
it" into a visible gap instead of an assumption.
Gate: 166 vitest tests; the full e2e spec (19) passes against a production
build, including the new RFP compare-and-award spec.

## Phase 3 gate: e2e and the demo story (S-15)

The gate adds one spec that ties S-13 and S-14 into the kickoff story: the attrition alert is
cleared by a release, and the RFP award is a commitment in budget-to-actuals with no
attrition line on the ledger. 20/20 e2e on a production build. The demo script is
`docs/DEMO.md`. Verdict on the producer-review features: attrition-as-decision **validated**;
RFP normalization **validated**. No new money logic, so no new defects found.
