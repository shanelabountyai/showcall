# Next

**S-11 — Phase 2 gate.** See `docs/backlog.md` S-11: e2e on a production
build plus the demo story — a speaker submits v7 after lock → override →
revalidate → distribution package rebuild. The browser path for that override
is still unit-tested only (carried from S-9); this is where it lands.
Recommend Opus: it is the phase gate, and the fixture has to prove the
lock/override/stale-rebuild loop end to end rather than just exercise it.

State after S-10:
- Gate is green — 124 unit tests, 13 e2e on a production build, clean build.
- Dev and test databases are migrated (`20260923120000_chase_dashboard`) and
  seeded. The dev reset carried from S-9 is done.
- Chase board is at `/events/<id>/chase`. Reasoning in D-017.

Watch-outs for S-11:
- **Every booked speaker now owes a `Session deck`** (seed change, D-017), so
  a speaker in the e2e can have two deck deliverables — scope portal
  selectors to the deliverable's `<section>`, not the page. That already bit
  the S-8 spec once.
- Stale packages surface on the chase board but rebuild stays a producer's
  button (D-016) — the gate story should click it, not expect automation.
- The seed's chase pass runs on a clock 28 days back so the escalation button
  is live at (8); an e2e that sends reminders leaves it at (0) for anything
  after it in the serial run.
