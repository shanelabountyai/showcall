# Backlog

One item per session. Phase gates from the PRD: no phase advances while the
prior gate's fixtures or demo story fail.

## Phase 1 — the spine

| ID | Item | Status |
|---|---|---|
| S-1 | Scaffold; agenda grid schema; conflict engine (room, turnover, speaker); publish → append-only version; public agenda view | ✅ |
| S-2 | Cue graph: run-sheet cues per room/day derived from agenda + production items, dependency anchors, cascade preview → atomic commit, slack and impossible-compression detection | ✅ |
| S-3 | Role-filtered call sheets: per-role projection, versioned issues, changed-since-last-issue diff, no-over-disclosure sweep, PDF | ✅ |
| S-4 | Stage-manager live mode: current/next cue, running offset → projected times (polling) | ✅ |
| S-5 | P0-8 basics: event/client, staffing assignments with capacity + day-of roles; agenda editing UI; seeded two-day three-track conference; GO gated to the SM (D-011) | ✅ |
| S-6 | Phase 1 gate: e2e on a production build, demo story (keynote moves 15 min → cascade → filtered re-issues) | ✅ |

## Phase 2 — the content machine

| ID | Item | Status |
|---|---|---|
| S-7 | Speaker bureau: lifecycle state machine (`invited→confirmed→contracted→content_complete→rehearsed→showed→released`), profile/AV/honorarium fields, rehearsal slots against the existing conflict engine, release/consent flags (record/distribute/publish) as structural gates with a no-path fixture | ✅ |
| S-8 | Content turn-in pipeline, part 1: tokenized submission portal for speaker decks + sponsor deliverables, versioned uploads (v1…vN kept), comment/review cycle per version, technical validation rules-as-data with a plain-language fix list | ✅ |
| S-9 | Content turn-in pipeline, part 2: approve → show-file lock (immutable), late-revision override (logged, re-validates), per-room distribution builder (checksummed manifest, running order from the agenda), stale-package flag that clears only on rebuild | ✅ |
| S-10 | Chase dashboard: turn-in deadlines derived from show date minus lead time, reminder outbox, escalation worklist, bureau missing-item flags (no headshot, unsigned, unvalidated deck) and lifecycle funnel rolled in | ✅ |
| S-11 | Phase 2 gate: e2e on a production build, demo story (a speaker submits v7 after lock → override, revalidate, distribution package rebuild) | ✅ |

Order follows the dependency chain, not the PRD's P0 numbering. Bureau (S-7)
goes first because the portal in S-8 is per-speaker and the consent flags
are bureau fields: S-7 ships them as a gate function (releasable assets
require `distributeDeck`/`publishVideo` true) with its own no-path unit
test, proven before there is anything real to gate. S-8/S-9 then build and
test validation per the build notes' TDD order (conflict engine → cascade →
**validation rules → consent no-path test**), and S-9's distribution builder
calls S-7's gate when assembling a room's package — so an unreleased
speaker's asset structurally cannot enter a manifest, closing the loop the
unit test only asserted in isolation.

See D-012 for the reasoning kept out of this table; D-017 for S-10's.

## Phase 3 — the money mechanics

| ID | Item | Status |
|---|---|---|
| S-12 | Budget spine (P0-8 rest): vendors; compliance docs (COI, W-9) with expiry and a nag worklist; budget lines per event and category — committed vs. actual, integer cents, client-billable flag; append-only budget snapshots; budget-to-actuals view | ✅ |
| S-13 | Room-block attrition (P0-5): blocks as rooms × nights × rate with dated thresholds; pickup vs. required pace, shortfall in cents at each threshold, cutoff release — all by fixture; alerts ahead of penalty dates framed as a decision ("release 10 by Friday or accept $2,400"), logged; accepted exposure posts to the budget; speaker/staff/VIP rooms draw from the block and count toward pickup | ✅ |
| S-14 | RFP normalization (P0-6): registration headcount by attendee type (the quantity basis for per-head lines); line-item schema per category as data; quotes entered as normalized lines (included / excluded / extra-cost); comparison view — totals, per-unit, inclusion matrix, gaps highlighted; award → budget commitment + contract-status record, flagged when the vendor's compliance has lapsed | ✅ |
| S-15 | Phase 3 gate: e2e on a production build, demo story (an attrition alert before D-30 → release rooms, decision logged, exposure drops; a catering RFP compared and awarded → it appears as a commitment in budget-to-actuals) | ✅ |

## Phase 4 — judgment day

| ID | Item | Status |
|---|---|---|
| S-16 | Contingency plans as data (P0-7, part 1): trigger criteria, decide-by time, owner, branches each carrying a cascade (run-sheet variant, vendor notifications, cost delta); the decide-by enters the run sheet as a cue; an unmade decision escalates at its deadline (outbox + dashboard) | ✅ |
| S-17 | Branch execution (P0-7, part 2): execute → preview → atomic commit through the existing cascade; the branch that was not taken is archived with the decision log; cost delta posts to the budget; the rain-call fixture swaps the variant and re-issues **exactly** the affected call sheets | ⬜ |
| S-18 | Venue profiles (P0-8 rest): dock, power, rigging, ceiling, wifi, union house rules as structured data; load-in / load-out slots planned against them as production cues | ⬜ |
| S-19 | Phase 4 gate — the capstone: e2e on a production build, the PRD's five-minute story (v7 after lock, keynote moves 15 min, rain call executes at its decide-by cue) | ⬜ |

### P1, ranked — after the capstone

| ID | Item | Status |
|---|---|---|
| S-20 | P1-5 post-event reconciliation: planned vs. actual cue times from the GO log (D-010), final attrition math, budget close | ⬜ |
| S-21 | P1-3 vendor/crew portal: tokenized sheet, COI upload, receipt confirmation that clears the re-issue flag | ⬜ |
| S-22 | P1-1 crew work rules as data: breaks, meal-penalty and overtime warnings during run-sheet edits | ⬜ |
| S-23 | P1-6 client approval gates on budget and scope changes | ⬜ |
| S-24 | P1-7 dietary and accessibility rollups for catering (counts, never names) | ⬜ |
| S-25 | P1-4 portfolio calendar with cross-event staff conflicts | ⬜ |
| S-26 | P1-2 post-show asset distribution to attendees, consent-gated | ⬜ |

Budget goes first because it is the sink: attrition exposure (S-13), RFP
awards (S-14) and contingency cost deltas (S-17) all post into it, so each
of those writes to a real ledger instead of having one added later — the
same reasoning as D-012. See D-018 for the rest, including the P1 ranking.
