# Showcall Live — phase 2: deployed and measured (S-31)

**Status: draft for Shane's review (2026-10-19). Nothing here is started.** Reads:
`docs/live/prd-showcall-live.md` (Phasing, Success metrics), D-033 (deploys go through the
`main-manual` hook, push-to-deploy is off), D-034 (Neon baseline about 2.1 compute hours a
day), D-043 (SSE + seq poll, hidden tabs disconnect), O-4 (poll and stream life) and O-5
(Neon awake while a view is open) in `docs/decisions.md`, and the L1.0 spike result in
NEXT.md. Phase 2 adds no product feature: it ships phase 1 to the deployed site, measures
it, and decides O-4 and O-5 from the numbers. No adjective without the number.

**Exit:** latency p50 and max over 20 edits on the deployed site against the PRD target
(≤ 2 s p50, ≤ 3 s max); Vercel function GB-hours and Neon compute hours for a one-hour
demo with three views open, against D-034's baseline; the 280 s stream cut and reconnect
observed in the wild; O-4 and O-5 decided as dated D-entries; a DEMO.md stop; WRITEUP
verdicts; backlog S-30 and S-31 ✅.

## Before L2.1 (Shane)

- **Merge order.** The hook deploys `main`, so phase 1 has to be on `main` first: PR #2
  (`live-phase-1` → `live-kickoff`) once its CI is green, then PR #1 (`live-kickoff` →
  `main`). S-30 is ✅ only when the story spec is green too (NEXT.md).
- **Who presses deploy.** Triggering the `main-manual` hook is a production deploy and
  costs build minutes (D-033). Proposed: Shane triggers it, or tells a session to.
- **Where the numbers come from.** GB-hours from the Vercel usage view (or its API) and
  compute hours from the Neon console for the project's endpoint (`ep-calm-wind-b5bnk5tv`,
  D-034), read for the demo window only. Both are read by hand unless a connector is set up.
- **Two left from phase 1:** delete the L1.0 spike preview (`vercel remove`), and add
  `LIVE_TEST_HOOKS=1` to the local `.env.test`.

## S-31 — deployed and measured

- [ ] **L2.1 Deploy.** Trigger the `main-manual` hook for the merged `main`. Confirm on
  the deployed site, behind the demo password: the producer, SM and crew views open their
  streams; `maxDuration` 300 and `LIVE_MAX_MS` 280 000 are what the deployed route runs
  with; `LIVE_TEST_HOOKS` is **unset** in Production (`?dropAfter=` must not work there).
  *Acceptance:* NEXT.md records the deployment URL and id, the commit, and a request with
  `?dropAfter=1` refused or ignored in Production.
- [ ] **L2.2 Deployed latency.** Run the L1.10 two-browser measurement against the
  deployed URL (same 20 edits, same commit-to-visible timing), from Shane's Mac in Chrome.
  *Acceptance:* p50 and max in WRITEUP next to the CI numbers (p50 917 ms, max 941 ms on
  the CI runner), and pass/fail against ≤ 2 s / ≤ 3 s. If over target, say by how much and
  do not tune in this item.
- [ ] **L2.3 Stream life in the wild.** Leave one view open past 300 s and record the cut
  second, the reconnect, the `Last-Event-ID` sent, and 0 lost / 0 duplicated changes across
  it (edit once inside the reconnect window). Hide the tab and confirm the stream closes
  (`visibilitychange`) and catches up on show. *Acceptance:* the numbers in NEXT.md and
  WRITEUP.
- [ ] **L2.4 One-hour cost run.** A one-hour demo with three views open (producer, SM,
  crew), a scripted edit every few minutes, nothing else on the project. Read Vercel
  function GB-hours and Neon compute hours for that hour only. *Acceptance:* both numbers
  with their source and time window, compared with D-034's baseline (about 2.1 compute
  hours a day before D-034), and the share of the $20 Vercel and Neon allowances the hour
  used.
- [ ] **L2.5 Decide O-4 and O-5.** From L2.2–L2.4: keep or change `LIVE_POLL_MS` 1000,
  `LIVE_MAX_MS` 280 000, `maxDuration` 300 (O-4), and accept or limit Neon staying awake
  while a view is open (O-5; the PRD's levers are a 2 s poll or transport C). Shane
  decides; each becomes a dated D-entry with the numbers it rests on. A changed value
  re-runs L2.2 and L2.4.
- [ ] **L2.6 Docs.** A DEMO.md stop ("two windows on the deployed site"), WRITEUP verdicts
  for the live features (validated, changed or cut, with the numbers), backlog S-30 and
  S-31 ✅, NEXT.md pointing at whatever comes next (phase 3 only if O-1 moves).

**Not in phase 2:** the transport swap (live phase 3, only if O-1 moves), any new view
or field, and any change to a hard rule.
