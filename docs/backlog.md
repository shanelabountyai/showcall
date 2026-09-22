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
| S-10 | Chase dashboard: turn-in deadlines derived from show date minus lead time, reminder outbox, escalation worklist, bureau missing-item flags (no headshot, unsigned, unvalidated deck) and lifecycle funnel rolled in | 🔲 |
| S-11 | Phase 2 gate: e2e on a production build, demo story (a speaker submits v7 after lock → override, revalidate, distribution package rebuild) | 🔲 |

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

See D-012 for the reasoning kept out of this table.

## Phase 3–4

Attrition + RFP + budget (P0-5, P0-6) · contingency + P1s (P0-7). Broken into
items when Phase 2's gate passes.
