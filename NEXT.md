# Next

**S-15 — Phase 3 gate.** An e2e run on a production build, plus the demo story. First, the
attrition alert before D-30: release the rooms, confirm the decision is logged and the
exposure drops. Then a catering RFP compared and awarded: it appears as a commitment in
budget-to-actuals. Both halves already have specs (S-13 and S-14 in `e2e/showcall.spec.ts`).
The gate should tie them into one story on the kickoff event, then write the demo
script section. Recommend Sonnet: this is assembly and verification, with no new money logic.

State: S-14 shipped (166 unit tests; 19/19 e2e on a production build). `/events/[id]/rfps`
holds registration (260 on the kickoff), the line-item schemas, and the comparison. In the
seeded Kickoff catering RFP, Harvest is cheapest but has a gap. Summit's $22,060.00 is the
lowest complete quote, and its COI lapses on day 1, so awarding it is flagged. The S-14
spec already awards Summit, so S-15 either reuses that step or re-seeds first.
Decisions: D-021.
