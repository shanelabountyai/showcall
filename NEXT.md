# Next

**S-14 — RFP normalization (P0-6).** Registration headcount by attendee type
(the quantity basis for per-head lines); line-item schema per category as
data; quotes entered as normalized lines (included / excluded / extra-cost);
comparison view — totals, per-unit, inclusion matrix, gaps highlighted;
award → budget commitment via `addLine(…, tx)` (it now takes a transaction,
S-13) + contract-status record, flagged when the vendor's compliance has
lapsed (`src/budget/compliance.ts`). Recommend Opus: money comparison and
the award path into the ledger.

State: S-13 shipped (157 unit tests; budget + attrition e2e pass on a
production build). Rooms page is `/events/[id]/rooms`; the seed's second
event (Northwind Fall Sales Kickoff, 40 days out) carries the D-30 alert
S-15's demo story starts from.
