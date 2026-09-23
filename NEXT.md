# Next

**S-13 — room-block attrition (P0-5).** Blocks as rooms × nights × rate with
dated thresholds; pickup vs. required pace, shortfall in cents at each
threshold, cutoff release — all by fixture. Alerts ahead of penalty dates are
framed as a decision ("release 10 by Friday or accept $2,400") and logged.
**Accepted exposure posts to the budget** as a line via `addLine()` in
`src/budget/budget.ts` (the sink S-12 built; D-018, D-019). Speaker, staff
and VIP rooms draw from the block and count toward pickup. Recommend Opus:
it is money math with penalty dates.

State: S-12 shipped (141 unit tests; the 3 budget e2e specs pass on a
production build; full e2e sweep left to CI). The budget page is
`/events/[id]/budget`.
