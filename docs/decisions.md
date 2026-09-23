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
