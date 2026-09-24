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

## D-016 · 2026-09-22 · Show-file lock, override, and two kinds of package

Shane's picks, for S-9.

**Lock is an append-only pointer, not a flag on a version.** `ShowFileLock`
rows say which version of a deliverable is the show file; the latest row wins.
The first is an *approve* (latest version only, refused if its validation
failed — an approval resolves *needs review*); every later one is an
*override*, which needs a reason and re-runs the event's current rules as a
new `ValidationRun` beside the old ones. **A failed re-validation refuses the
override** (Shane's pick): the lock stays where it was and the run stays in
the log with its fix list. A late upload through the portal is accepted as a
new version as before; it just does not become the show file until a producer
overrides. Versions were already immutable (S-8), so "locked files are
immutable" means the pointer cannot move without a logged override.

**`content_complete` now needs every deck approved and locked** (D-015's
guard, tightened as promised). Because approval resolves a review, the
brand-template `manual` rule moves back onto decks (D-015 addendum reversed).

**Playback is not distribution (Shane's pick: both, split by package).** A
*room* package is the playback set for one room: every locked deck and video
owned by the speakers of that room's published sessions, in agenda running
order, with a named gap for each one not locked yet. It has no consent check:
it plays a presenter's own deck in their own session, and gating it on
"distribute deck" would pull the deck from its own talk. An *attendees*
package is the post-show deck bundle, and every entry goes through
`releasable(…, 'deck')`: a withheld speaker's deck is not in the manifest at
all, and the reason is shown to the producer only. That is where hard rule 6
lives, and its no-path sweep test lands with it (D-012's fixture). This
corrects D-012's assumption that the room builder was the gate.

**A package is stale by content, like a call sheet (D-009).** Each build is an
append-only `DistributionPackage` with its manifest, a SHA-256 over the
manifest's canonical JSON, and the agenda version it was built from. Stale
means the manifest built now would have a different checksum. So an agenda
change that does not touch a room leaves its package current, and nothing can
clear the flag except a rebuild that makes the stored checksum match again. An
unchanged package is never rebuilt. Rebuild is a producer's button, not
automatic (the backlog's wording): the stale flag is the signal, and an
automatic rebuild would hide what changed.

**Running order comes from the published snapshot.** Sessions, their order and
their speakers are read from the latest `AgendaVersion`, so a draft speaker
swap does not reach a package until it is published. For that, `PublicSession`
gains `speakerIds`: opaque cuids like D-007's session ids, added to the
projection deliberately. This closes D-008's "the snapshot has no speaker ids".
Snapshots published before this carry none and contribute nothing to a
package; republish to fill them. Sponsor deliverables have no room, so they are
in neither package yet.

## D-017 · 2026-09-23 · Deadlines derive from the agenda; the cadence is a unique key

Shane's picks were not needed here — these follow from rules already set, and
are recorded because each had a tempting wrong answer.

**A deadline is never stored.** It is the owner's first call minus the lead
time for that kind: `addDays(callDay, -leadDays)`, computed on read
(`src/chase/chase.ts`). "First call" is the owner's earliest session, rehearsal
included — which is what makes the validation/rehearsal lead the PRD asks for
fall out for free, since a rehearsal *is* a session (D-013). So moving a
speaker's session moves their deadline with it, and there is no stored date to
go stale. This is D-003's rule applied to turn-in, and the alternative — a
`dueAt` column set when a deliverable is created — is exactly the silent drift
the project exists to avoid.

**Lead time is data, per event and kind** (`DeadlinePolicy`), like
`ValidationRule`. A kind with no policy shows **"no lead time set"** rather
than falling back to a constant: a fabricated deadline is worse than an
absent one, because a producer would chase against it. A second source of
truth in code was the tempting shortcut; there is one source.

**The reminder cadence is a unique key, not scheduling logic.** Steps are days
before due — 14, 7, 3, 0, −3, −7 — and `Reminder` is unique on
`(deliverableId, step)`. A step therefore cannot be sent twice however often
the producer clicks, with no dedupe code and no lock. `cadenceStep(daysLeft)`
returns the *most urgent step reached*, so **a skipped step never fires
retroactively**: a board opened for the first time a week late sends one
reminder, not the four it "missed". The alternative — replaying every missed
step — would deliver a burst of stale mail to someone who is already behind.

**The outbox row is the send.** There is no mail transport behind it,
deliberately: what a producer needs is proof it went out and when, and the
row is append-only (trigger) so it is kept exactly as sent. The body is
rendered once, at send time, and stored — never re-rendered later against a
deadline that has since moved.

**The chase board can only chase a deliverable that exists.** No phantom rows
are synthesised for a speaker who was never asked for a deck. That pushed a
change into the seed instead: every booked speaker gets a `Session deck`
deliverable, so the ones behind are overdue rows on the worklist rather than
invisible. A speaker with nothing on the board is a producer who has not asked
yet — which the bureau's missing-item flags say directly.

**Missing-item flags are the guards' own messages.** `missingItems()` in
`src/bureau/bureau.ts` is a superset of `contentMissing()` rather than a
parallel list, and the "next step blocked" line is `nextStepBlocked()` — the
same table `advance()` enforces. The board cannot disagree with the lifecycle
about whether a deck is approved, because it is not forming its own opinion.

## D-018 · 2026-09-23 · Phases 3–4 run the budget sink first; P1s are ranked by what they reuse

**Phase 3 is S-12 budget → S-13 attrition → S-14 RFP → S-15 gate.** The PRD
lists attrition and RFP first and calls the budget "spine", but three later
features post money into it: accepted attrition exposure, RFP awards, and
contingency cost deltas. Building the ledger first means each of those writes
a real committed line from its first day. Otherwise all three would need
retrofitting, which is what D-012 avoided for consent. Vendor compliance goes
with the budget because the vendor record is what an award lands on, and an
award to a vendor whose COI has lapsed should be flagged when it happens.

Attrition comes before RFP because it is the smaller surface and its money
link is one line (an accepted exposure), so S-13 proves the sink before S-14
leans on it hard. Registration headcount rides with RFP (S-14) and not with
the budget: per-head catering lines are the only thing in scope that reads
it.

**Phase 4 is S-16 plans → S-17 execution → S-18 venue profiles → S-19
capstone.** Contingency splits the way the pipeline did (D-012): the data and
the decide-by cue first, then execution through the existing cascade, with
the rain-call fixture landing in S-17. Venue profiles are the last of P0-8.
They sit in Phase 4 because load-in and load-out slots are run-sheet cues,
and the capstone should run with every P0 in place.

**The P1s come after the capstone and are ranked by reuse.** The PRD asks for
"P1 in ranked order" without giving a ranking. The order here is: P1-5
reconciliation (the GO log from D-010 already holds the actual times), P1-3
vendor portal (the token pattern from S-8 plus compliance from S-12), P1-1
crew rules (rules-as-data, as in validation), P1-6 client approvals, P1-7
dietary rollups (needs S-14's registration), P1-4 cross-event conflicts (the
crew model already counts capacity across events, so part of it exists), and
P1-2 attendee distribution last, because it needs an attendee delivery channel
and attendee-facing features are a non-goal. This is a default, not a verdict.
Re-rank it at S-19 if the capstone shows a different gap.

## D-019 · 2026-09-23 · Compliance nags get a sibling outbox; a budget line is what asks for papers

Settles the open question S-10 left for S-12. Shane's picks were not needed.
Each of these follows from a rule already set, and each is recorded because
it had a tempting wrong answer.

**`ComplianceReminder` is a sibling of `Reminder`, not a generalization of
it.** Generalizing would have meant nullable foreign keys (deliverable *or*
vendor), a check that exactly one is set, and a migration of rows that are
append-only by trigger. Two narrow tables keep real foreign keys and share
the only thing actually common to them, the cadence: `cadenceStep()` and
`WARN_DAYS` are imported from `src/chase/chase.ts`, not copied. An outbox
that covers every kind of reminder can be a `UNION` view later if a page ever
needs one. None does yet.

**The cadence key includes the due day.** `ComplianceReminder` is unique on
`(eventId, vendorId, kind, dueOn, step)`. A renewal that still lapses before
the show moves the due day, so its nags start a fresh cadence with no reset
code. The same key also makes each nag per event, which is right, because
the due day depends on the event's dates.

**A vendor needs papers for an event because it has a budget line on that
event.** Nothing else puts a vendor on the worklist, so a vendor Showcall
has never paid is never nagged. Vendors and their documents are house-wide,
like `Staff`: one COI on file covers every event it spans.

**Due days derive, as in D-017.** A missing document is due on the event's
first day. A COI that lapses before the event's *last* day is due on its own
expiry date. "In force through the last show day" counts as covered. A W-9
has no expiry, and a COI must have one. Both rules are a check constraint as
well as a refusal. Documents are append-only: a renewal is a new row, and the
latest one received is the one in force.

**Budget lines are working state; history is the snapshots.** Actuals arrive
as invoices do, and a change order moves a commitment, so a line is
editable. Every figure it ever held that mattered was frozen into an
append-only `BudgetSnapshot`, and the view shows drift against the latest
snapshot. An append-only line ledger (every change a new row) was the
alternative. It would make the view re-derive current state on every read,
to answer a question the snapshots already answer. Lines cannot go negative
(check constraint). A credit is its own line, not a sign flip hidden inside a
total.

**Dollars are parsed to cents without a float.** `parseCents()` splits the
typed string on the decimal point and does integer arithmetic. `"12.345"` is
refused by name, not rounded.

## D-020 · 2026-09-23 · Attrition: thresholds net, decisions execute exactly what was framed

Shane's pick, for S-13: **a later threshold nets what earlier ones already
put on the budget.** Each threshold shows its full shortfall. An accept posts
only the part not yet accepted, so the budget carries the worst shortfall
accepted and never the sum. The alternatives were independent penalties,
which double-count the same unsold room-nights, and billing only the final
threshold, which turns earlier dates into review dates. The rest follows
from rules already set:

**Nothing is stored that can be derived.** Pickup, projection, shortfall and
the release count are computed on read from the contract nights, the
reservations (each dated `bookedOn`) and the decision log (`assess()`, pure).
A passed threshold is judged as of its own date. Bookings and releases after
that date do not rewrite it.

**The projection is the average pace so far,** carried to the threshold or
the cutoff, whichever comes first, and rounded down. "80%" rounds the
requirement up. Both roundings lean toward raising the alert. An alert means
an open shortfall inside `ALERT_DAYS = 14`. Beyond that window it is a
*watch*. The alert shows on the rooms page and does not go to the outbox:
its audience is the producer, not a vendor.

**The release it asks for is exact.** The count is `contracted −
floor(100 × (projected + accepted) / percent)`, the smallest release that
clears the open shortfall, and a fixture proves that one fewer does not.
Releases come off the emptiest nights first. A release is a logged decision
(`AttritionDecision` plus per-night `BlockRelease` rows, both append-only)
and never an edit to the contracted nights.

**A decision carries the figure the producer saw.** It is refused if the
numbers have moved since the page was rendered. Nobody signs off on an amount
they did not see. An accept posts a `travel` line against the hotel (a
`Vendor`) in the same transaction as the decision, through `addLine(…, tx)`,
and a check constraint ties every accept to its line. Every write locks the
block row, because inventory and netting are both read-then-write.

**The cutoff returns unsold rooms to the hotel.** After it, nothing books and
nothing releases, and attrition is still owed on the contracted block,
because that is how the contracts read. Speaker, staff and VIP rooms are
reservations like any other. They link their person (check constraint) and
count toward pickup.

Not done: cancellations (a reservation is deleted by hand for now, so a past
threshold's pickup can shift), caps on how much can be released, partial
releases (a producer releases the exact count or accepts), and paying for
the rooms themselves on a master bill.

## D-021 · 2026-09-23 · RFP normalization: a base price, three answers per line, and an award that records rather than refuses

For S-14. None of these needed Shane's pick. Each follows from a rule already
set, or is the default that is cheapest to reverse.

**A quote is a base price plus answers.** The base is flat or per head, and
it covers every line answered `included`. An `extra` line adds unit ×
quantity. An `excluded` line is a gap, and the total leaves it out. This
matches how the proposals read ("$72 per person, all-inclusive — service staff
additional"), so entering one is transcription rather than arithmetic. Per-line
prices for included items were the alternative. Vendors do not state them, so
they would have been invented.

**Every line must be answered.** A quote cannot be entered with a line left
blank. A vendor who stayed silent on an item is recorded as `excluded` until
they say otherwise. This removes an "unanswered" state from the matrix, and
with it the question of whether silence means included.

**Quantities derive.** A `per_head` line's quantity is the registration total,
summed across attendee types and read at compare time. An `each` line's
quantity is set on the RFP. A `flat` line's quantity is one. Nothing is stored
that can go stale when registration moves.

**"Lowest complete" skips any quote with a gap.** The cheapest quote on paper
is often cheap because it leaves something out. The matrix highlights both the
gap row and the excluded cell.

**The schema is data, and an RFP copies it.** Editing `LineSchema` never
rewrites an RFP that is already out to vendors. RFP lines cannot be added
after creation, so every quote on an RFP answers the same list.

**The award follows D-020's rule.** It carries the total the producer saw, and
it is refused if that total has moved (a headcount change, a revised quote).
The budget commitment and the `Contract` are written in one transaction
through `addLine(…, tx)`, and each row is unique on the RFP, the quote and the
budget line. After the award the RFP is closed: no quotes, no quantity edits.

**Lapsed papers and gaps are recorded, not refused.** The award stores what
`papersOutstanding()` said at that moment (the same rule the compliance
worklist uses; `standing()` is shared) and the quote's gaps. Refusing would
block a producer from signing the only caterer available. What D-018 asked for
was that the award be *flagged*. Once the vendor has a budget line, it joins
the compliance worklist on its own (D-019).

**The contract status only moves forward:** awarded → sent → signed.

Not done: a headcount change after the award does not move the commitment.
Per-head guarantee adjustments are change orders (`updateLine`). Also not
done: per-attendee-type quantities (catering for sales reps but not guests),
percentage lines (service charge, gratuity), and attaching the vendor's PDF.

## D-022 · 2026-09-23 · Contingency plans: the decide-by is a cue, escalation is keyed by the deadline

No picks were needed from Shane for S-16. Each choice follows from a rule
already set, and is recorded because each one had a tempting wrong answer.

**The decide-by is a run-sheet cue, not a timestamp column.** A plan owns
exactly one cue (`decideByCueId`, unique), labelled `Decide: <title>`, zero
minutes long, fixed or anchored like any other (D-006). So "call it 7 hours
before the reception" moves with the reception, and the PRD's "decide-by
times enter the run sheet as cues" is literally true: the cue is in the run
sheet, and the live console shows it. The plan and its cue are written in one
transaction (`insertCue(tx, …)`), and a decide-by that breaks the run sheet
is refused with the plan. The cue is tagged to no role, so it never reaches a
call sheet (hard rule 7).

**State is derived on read; the only write is the escalation outbox.**
`open` → `due` inside `WARN_MIN = 60` → `overdue` at the decide-by →
`decided` once a `ContingencyDecision` exists. The escalation's unique key is
`(planId, day, minute)`, meaning the deadline itself. One deadline escalates
once however often the sweep runs, and a decide-by that moves later owes a
fresh escalation at its new time. This is the same move as the chase cadence
(D-017) and compliance (D-019). It goes to the owner and every producer on
the event, deduplicated.

**The sweep is a route for a scheduler, not a side effect of a page.**
`/api/cron/escalate` runs `escalateAll`, and `vercel.json` schedules it each
minute. Nothing is deployed, so locally the dashboard state is exact but the
outbox row appears only when the sweep runs (the seed runs it once, and so
could a `curl`). Writing on page render was the tempting shortcut. D-017 kept
send out of GETs on purpose.

**A branch is data in the cascade's own shape.** `cueEdits` is `CueEdit[]`
plus an optional `roomId`, because a rain call is a room move. The cascade
does not take `roomId` yet, and `diffTimings` does not see a room change. S-17
adds both, since an unseen room move would slip past the preview-equals-commit
check. Cue and room references are checked at creation. Whether the variant
still applies cleanly is S-17's preview, at execution time, against the sheet
as it is then.

**A cost delta is non-negative (check constraint).** It posts as a committed
line through `addLine` (D-018), and lines cannot be negative. A branch that
saves money, such as cancelling a tent, is not expressible yet. Add it as a
change to an existing line if a producer asks.

**A decision is one per plan, of that plan's own branch** (composite foreign
key), and append-only. S-16 creates the table so that "unmade" is a real
query. S-17 writes it.

Not done: creating plans from the UI (the seed and `createPlan` only), and
branches that change the agenda. "Hold the keynote 10 minutes" is a publish,
not a cue edit, so a branch cannot express it.

## D-023 · 2026-09-23 · Executing a branch: one transaction, the preview is the contract

No picks were needed from Shane for S-17. Each choice follows from D-006 (the
cascade is the only writer of the run sheet) and D-022.

**The cascade learned rooms before it learned branches.** `CueEdit` takes
`roomId` (checked against the event), and every timing now carries its room
name, so `diffTimings` reports a move whose only change is the room. Without
this, the rain branch's room move would have passed a preview that showed
nothing. As a side effect, a rebase that moves a session to another room now
shows up in its preview too.

**The decision, the cue edits and the cost line are one transaction.**
`commitCascade` takes an `also(tx, result)` hook that runs after the
preview-equals-commit check, under the event lock. A refusal there undoes the
cascade. The decision row stores the cascade exactly as committed (`moved`)
and the budget line it posted (`budgetLineId`, unique). A second caller finds
the decision under the lock and is refused.

**Call sheets re-issue after the commit, not inside it.** `issueCallSheets`
reads the committed run sheet and issues only the roles whose projection
changed. A stale run sheet (agenda published past it) refuses to issue: the
call still stands, and the sheets show stale. The re-issue is stamped with
the decision's own instant, which is how the decision log names the sheets
without a join table.

**Vendor notices go out with the decision.** The decision row is the send
record for the taken branch's notices (branches cannot be edited), so there is
no separate outbox. Add one when a notice has to be delivered somewhere real.

**The branch not taken is archived by staying where it is.** Branches are
never edited or deleted once a decision references the plan (restrict FKs),
so the plan shows both, marked taken or not taken.

**The execute form carries the preview.** The `expected` cascade goes in a
hidden field. If the sheet changed since the preview, the commit refuses
(`CascadeChanged`) and nothing is written: no decision and no budget line.

## D-024 · 2026-09-23 · Venue profiles: house facts the cascade checks

No picks were needed from Shane for S-18. Each choice follows from D-006 (the
cascade is the only writer of the run sheet) and D-023.

**The profile is split by what it describes.** `Venue` holds building-wide
facts: dock bays, dock hours, the longest truck the dock takes, wifi, and the
union house's minimum call. What a space can take (ceiling, rigging points and
their rated load, house power) is on `Room`, because a rain call moves a cue
between rooms and the check has to follow it. A null ceiling means open air.

**A load slot is a cue plus its needs.** `LoadSlot` hangs off a cue, the same
way a contingency plan hangs off its decide-by. Its time is never stored. The
seeded AV load-out is anchored to the reception, so the rain call pushes it 30
minutes, and the preview shows that.

**Venue rules are cascade problems, not a separate check.** `resolveAt` adds
`venueProblems` (`src/venue/rules.ts`) to the cue graph's problems. So a
change that pushes a load-out past dock close, overfills the dock, or moves a
rig into a room that cannot hang it is refused by the same invariant as a
compression. This covers edits, rebases, contingency branches and inserts.
`insertCue` takes an `attach` hook, so the slot row exists before the check
runs.

**Profile edits re-check what is planned.** `saveVenue` and `setRoomSpec`
re-run the check on every event they touch, inside the edit's transaction.
An edit that would break a planned slot is refused, and the refusal names the
slot. A profile can never silently disagree with the load plan.

**The minimum call bills, it does not refuse.** A one-hour florals load-in at
a union house is legal; it is billed as four hours. The load plan shows the
billed length. Overtime and meal penalties are S-22 (P1-1).

Not done: two events sharing one venue's dock on the same day are each checked
alone (a `ponytail:` comment marks it). Anchored slots are planned from the
seed and `planLoad` only; the page plans fixed-time slots. Room specs are
edited through `setRoomSpec`, not the page.

**Rebase from the page (Shane's pick, S-18).** The full e2e sweep showed that
the S-17 rain spec only passed when run alone. Earlier in the sequence the
keynote story publishes v2, and nothing in the app could rebase the run sheet,
so the rain call's re-issue was refused as stale. Shane chose a rebase control
over weakening the spec. The live page's stale warning now carries **Rebase and
re-issue call sheets**. It previews and commits the rebase through the cascade
in one action, refused whole on any problem (venue problems included). Then it
re-issues the sheets the rebase changed, so the next change re-issues only its
own sheets. CI runs no e2e, so the full sweep on a production build is the
gate at each item, not a subset of specs.

## D-025 · 2026-09-23 · Reconciliation: slip from the GO log, attrition nets to the worst shortfall, the close is a freeze the database holds

Shane picked S-20 ahead of project closure, so the brief and the posts will
cover the P1 scope. Nothing else in this entry needed his call.

**Planned vs. actual reads the GO log and stores nothing.** A row's actual
time is its latest GO, because a later GO corrects an earlier one (D-010).
Planned is the `plannedMin` stamped when GO was called, not the row's time
today. A rebase or a rain call after the fact does not make an on-time cue
look late. *Added* is a row's slip minus the slip of the previous called row
in the room, so the report names the cue where the delay came from, not only
how late the day ended. A GO on a row the run sheet has since dropped still
happened, so it stays in the report. Limit: a mistaken GO on a row that is
never GO'd again stays in the record as an actual time. The log cannot tell a
wrong GO from a right one.

**Final attrition reuses `assess()`.** After the last threshold, each one is
judged as of its own date. The hotel is owed the worst shortfall × rate, not
the sum, the same netting as D-020. A positive gap (owed − accepted) blocks
the close, and the fix is the existing accept on the rooms page, so no second
path posts attrition. A negative gap means an accept was made on a projection
that later bookings beat. That is over-accrual: it is shown and does not
block. The hotel's invoice is the actual, and the producer can adjust the
line's committed figure.

**The close is a final snapshot (`BudgetSnapshot.final`, one per event by a
partial unique index).** Once it exists, a trigger refuses every insert,
update or delete on the event's budget lines. The module refuses first with a
`BudgetRefused` in words, and the trigger backstops any path the module does
not cover. The close takes `FOR UPDATE` on the event row, and the trigger
takes `FOR SHARE`, so a line write that races the close waits for it and is
then refused. The close is refused, with every blocker named, while the show
is not over, while a committed line has no actual ("awaiting invoice", and a
cancelled line gets its committed set to $0), while a threshold has not
passed, or while attrition is owed but not posted. It carries the actual total
the producer saw and is refused if that total has moved.

Not done: reopening a closed budget (there is no path to reopen by design;
correcting a mistake would be a new event-level decision), per-crew overtime
in the reconciliation (S-22), and client sign-off on the close (S-23).

## D-026 · 2026-09-23 · Crew portal: a link per call role, receipt per issue, COI waits for a producer

Shane's picks, all three as recommended.

**The link belongs to a `CallRole`** ("Florist", "A1 Audio"), not to a
house-wide `Vendor`. A role can carry an optional vendor. If it does, its
portal also takes that vendor's COI. Crew roles see only their sheet and the
receipt button. The page shows the role's **latest stored issue**, not the
live projection, so the recipient sees exactly what was sent, and the changes
listed are measured against the issue before it.

**Receipt is per issue** (`CallSheetReceipt`, append-only, one per issue).
`callSheetStatus` gains `awaitingReceipt`: the latest issue has no receipt.
This is the "re-issue flag" that the PRD says a receipt clears. Staleness
(D-009) is a separate thing and is still cleared only by issuing. A re-issue
raises the flag again. Confirming an older issue is refused, because it is not
the sheet the recipient should be working from. A second confirmation is a
no-op (`ON CONFLICT DO NOTHING`), so a double-click cannot write twice.

**A portal COI is a pending `CoiSubmission`** until a producer opens the file
and accepts it on the budget page, entering the expiry printed on the paper.
The accept records the `ComplianceDoc`, dated the day of the upload, in the
same transaction. A link is not an identity: anyone who holds it could upload,
so an upload alone never clears the compliance gate. A trigger keeps the
submission append-only, except that `docId` can be set once, from null.

**SEC-04 and SEC-05 fixed with it, for both portals.** Issuing a link returns
the raw token as server-action state (`app/issue-link.tsx`), so it is never
put in a URL. A link dies **seven days after its event's last day**, in the
event's timezone. That is derived from the event at check time, not stored in
a `portalTokenExpiresAt` column as the audit suggested: a stored date would
drift when the event moves, and the one rule covers every portal. An expired
link returns the same 404 as a bad one, and writes through it are refused.
`/portal/*` sends `Cache-Control: no-store`, `Referrer-Policy: no-referrer`
and `X-Robots-Tag: noindex, nofollow`.

Not done: rejecting a submission (a bad upload stays pending until a better
one is accepted), W-9 upload, a PDF download on the portal, and per-token rate
limits (SEC-07).

## D-027 · 2026-09-23 · Crew work rules: a call role's call to wrap, warnings with a price, never a refusal

No call needed from Shane; the defaults below are recorded so they are not
re-opened.

**The shift is a call role's, read from its cues.** A role is on the clock
from its first tagged cue to its last on each day — the call and wrap its
sheet prints. NEXT.md suggested S-5's `Assignment`, but an assignment is a
fixed window the run sheet never moves, so no run-sheet edit could trip a rule
on it; its daily cap is already refused by `assign` (S-5).

**Rules are one `CrewRules` row per event**: straight-time day, meal limit,
the gap that counts as a meal, and the penalty per started step. A database
check keeps every limit and step positive. No row, no warnings. Edited in the
seed, not the page, as room specs are (D-024).

**Warnings, not problems.** A producer may choose to pay a penalty, so the
cascade returns `warnings` beside `problems` and never refuses on them. Each
carries `isNew`: the change caused it, as opposed to a warning the sheet
already had. A meal penalty is priced in cents; overtime is in minutes,
because no crew rate exists to price it. The branch preview and the call-sheet
page show them; the crew portal does not (it shows stored issues only).

Not done: per-crew overtime in reconciliation (would need rates and the GO
log's actual wrap), turnaround between days, and an escalating penalty scale.
A gap between cues is treated as paid time (a split call), so a long gap still
counts toward the day.

## D-028 · 2026-09-23 · Client approval: an approved baseline, unapproved spend blocks the close, lines never wait

Shane's pick, as recommended: the approved-baseline option, not pending change
orders.

**The client approves a snapshot, not a change.** The producer sends a
snapshot (`BudgetSnapshot.forClient`), and the client approves or declines it
through a link (`Event.clientTokenHash`, the same token and expiry rules as
D-026). The answer is a `BudgetApproval`: one per snapshot, append-only by
trigger. A decline must say why and every answer must carry a typed name
(check constraints). Only the latest sent snapshot can be answered. The same
answer twice does nothing, and the opposite answer is refused. The latest
approved snapshot is the baseline. A decline leaves the earlier baseline in
place.

**Lines never wait on the client.** Pending change orders were the
alternative. Under them, attrition accepts, RFP awards and a show-day rain
call would all need a pending path, and a rain call would wait on a client's
inbox. Instead, spend posts as it always has. Billable spend above the
baseline is *unapproved*, and the close (D-025) is refused while any of it
remains, with each line named. The client is billed only what they approved.

**Unapproved is per line, at exposure.** A line's exposure is
`max(committed, actual)` if it is billable, and $0 if it is house cost. Each
line is compared with its own figure in the baseline, so moving money out of
one line into a new one still counts as a change the client has not seen. A
decrease never needs approval. With no baseline, every billable cent is
unapproved.

**The client sees a projection.** Their page shows billable lines only
(category, description and amount), plus what they last approved for each.
It never shows vendors, house lines or actuals broken out.

Not done: "scope" here means budget lines. Agenda changes do not go to the
client. There is no email to the client (the link is shown once, as with every
portal), and there is no per-line approve/decline, because the answer covers
the whole snapshot.

## D-029 · 2026-09-23 · Dietary and accessibility: attendee records, a counts-only projection, a fixed list of needs

**Shane picked attendee records over counts-only storage.** Registration was
only a headcount per attendee type. The options were to store needs as counts
(names never enter the database), to store anonymous responses, or to store
attendees with names and emails and project counts from them. Shane chose the
third: the producer sees who needs what, and catering sees `rollup` in
`src/rfp/needs.ts`. Its shape is asserted by sweep, the same way call sheets
are (hard rule 7).

**Needs come from a fixed list, never free text.** A "notes" field is how a
name reaches the caterer ("Dana's nut allergy"). Every label in a rollup is a
row of `Need`, and an attendee references needs by id.

**Counts are event-wide, never split by attendee type.** Two VIPs and "VIP:
wheelchair 1" identifies a person. Catering gets exact counts, because a
suppressed count of 1 is a vegan with no meal. The page also says how many
registered people have no record, so an unknown is not read as a zero.

**The caterer sees it only through a portal role whose vendor holds this
event's catering contract** (D-026 link rules). Every other role gets null.

**Records and headcount are separate on purpose.** `Registration.registered`
still drives per-head pricing (D-021). Attendee records are whoever has come
across from registration so far, and the gap is shown rather than reconciled.

Not done: importing a registration export, editing or removing an attendee,
per-meal counts (breakfast vs gala), and a Knotwork shared module (Knotwork
does not exist on disk, D-001).

## D-030 · 2026-09-23 · Portfolio calendar: overlaps refused in real time, a short turnaround between events is a warning

**Shane picked overlap plus turnaround** over overlaps only and over a
per-venue travel matrix.

**Shifts are compared as instants, each event in its own timezone.** Before
this change, `assign` compared minute-of-day across events as if every event
shared one wall clock. A Chicago shift from 13:00 to 17:00 and a Los Angeles
shift from 10:00 to 13:00 (12:00 to 15:00 Chicago time) were both accepted,
and back-to-back cross-timezone shifts were refused. `instantOf`
(`src/time.ts`) converts a venue wall clock to an instant. `assign` now looks
at the day before and after too, because a shift late in Los Angeles
overlaps one after midnight in Chicago.

**Turnaround is a warning, never a refusal (as in D-027).** A person moving
between two different events with less than `MIN_REST_MIN` (10h) of rest is
flagged on `/calendar` and on both events' staff pages. The rest counts real
time, so a 23:00 CT wrap before a 6:00 PT call is 9h, not 7h. Two shifts on
the same event are a split call and never raise a turnaround.

**One constant, not a travel matrix.** Different events are treated as
different venues. A crew member who is local to both venues gets a warning
they can ignore.

Not done: the daily cap still counts the venue-calendar day, so a
cross-timezone day can run a few hours over (a rolling 24h would fix that);
travel time per venue pair; and a month-grid view (the calendar is a
by-date list).

## D-031 · 2026-09-23 · Post-show distribution: session recordings under both flags, a link per attendee, consent re-checked on every download

**Shane picked session recordings gated on both flags** over "publish video"
alone and over decks and speaker videos only. Production uploads a recording
per published session (`SessionRecording`, append-only; the highest number
ships). A recording that reaches attendees is a published video of the
session, so it needs "record session" *and* "publish video", from **every**
speaker on the session. One holdout on a panel withholds the recording, and a
session with no speakers is withheld because nobody can consent for it.
`releasable` now takes the owners and the kind per item (`withheldAll`).
Speakers' locked videos join the attendee package under "publish video".
Recordings stay out of room packages: playback happens before the show.

**Shane picked a link per attendee** over one shared link. Links are issued
in bulk to attendees who have none (existing links are left alone), and can
be reissued or revoked one by one. Every download is logged against the
attendee (`RecapDownload`). A recap link lives 90 days after the show, not
the crew portal's 7, because it is used after the show by definition.

**What a link serves is the last *built* package intersected with the
manifest built *now*.** The built package is what the producer sent. The
current manifest has just passed the consent gate. A speaker who withdraws
consent after the build is gone from every recap page and every download at
once, without waiting for a rebuild. A newly released asset, on the other
hand, waits for the producer's rebuild, as D-016's stale flag intends. The
download route resolves the file through the same intersection, so no URL
serves a file that is not on the page. Hard rule 6 now holds at both build
time and serve time.

Not done: sending the links (there is no email seam; the producer copies
them), per-session recording validation rules, and streaming large
recordings (bytes still live in Postgres under the 25 MB ceiling, SEC-07).

## D-032 · 2026-09-24 · Deployed demo at showcall.labintelligence.co behind a shared password

**Shane's picks: a shared demo password, portals behind it too, deploy
before closure.** `proxy.ts` requires HTTP Basic against
`DEMO_ACCESS_PASSWORD` (any username, compared in constant time) on every
route: pages, server actions, file routes and portals. It follows
rent.labintelligence.co (rental D-257). On Vercel, a missing password fails
closed with a 503. Off Vercel (dev, e2e) there is no gate. The cron path is
the only exemption, because it carries its own `CRON_SECRET`. Putting the
portals behind the password keeps SEC-07's unthrottled upload off the open
internet. SEC-01 proper (users, a guard on each action) stays open: anyone
with the password is a producer.

**The production database holds the demo on purpose.** It is Neon project
`showcall` (us-east-2), migrated and seeded from a laptop with
`SHOWCALL_ALLOW_CLOUD_DB=1` typed on purpose. The runtime carries the same
flag. Synthetic data only, as everywhere in this repo.

**The deployed cron runs hourly, not every minute (D-022).** A per-minute
call keeps a free-plan Neon compute awake around the clock, which is more
than the free allowance. Escalations land within the hour instead of within
the minute.

Known ceiling: Vercel caps a request body at 4.5 MB, so uploads above that
fail on the deployed site even though the app allows 25 MB.
