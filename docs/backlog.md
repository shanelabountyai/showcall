# Backlog

One item per session. Phase gates from the PRD: no phase advances while the
prior gate's fixtures or demo story fail.

## Phase 1 — the spine

| ID | Item | Status |
|---|---|---|
| S-1 | Scaffold; agenda grid schema; conflict engine (room, turnover, speaker); publish → append-only version; public agenda view | ✅ |
| S-2 | Cue graph: run-sheet cues per room/day derived from agenda + production items, dependency anchors, cascade preview → atomic commit, slack and impossible-compression detection | ✅ |
| S-3 | Role-filtered call sheets: per-role projection, versioned issues, changed-since-last-issue diff, no-over-disclosure sweep, PDF | ⏳ next |
| S-4 | Stage-manager live mode: current/next cue, running offset → projected times (polling) | |
| S-5 | P0-8 basics: event/client, staffing assignments with capacity + day-of roles; agenda editing UI; seeded two-day three-track conference | |
| S-6 | Phase 1 gate: e2e on a production build, demo story (keynote moves 15 min → cascade → filtered re-issues) | |

## Phase 2–4

Content pipeline + bureau (P0-3, P0-4) · attrition + RFP + budget (P0-5, P0-6) ·
contingency + P1s (P0-7). Broken into items when Phase 1's gate passes.
