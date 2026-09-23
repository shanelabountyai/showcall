# Next

**S-12 — budget spine.** Vendors, compliance docs (COI, W-9) with expiry and
nag worklist, budget lines per event/category (committed vs. actual, integer
cents, client-billable), append-only budget snapshots, budget-to-actuals view.
It goes first because attrition, RFP awards and contingency deltas all post
into it (D-018). Recommend Opus. It is money, and three later items write to
this ledger.

Open question for S-12: `Reminder` is keyed to a `Deliverable`. The compliance
nag worklist needs either a generalized outbox or a sibling table. Decide it
in S-12, not before.

State: Phase 2 gate green (124 unit, 14 e2e). Phases 3–4 scoped as S-12..S-26
in `docs/backlog.md`.
