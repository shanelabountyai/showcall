# Next

**S-22 — P1-1 crew work rules as data.** Warn about breaks, meal penalties and overtime while the run sheet is
being edited. See `docs/backlog.md` P1. Model pick: Opus, because meal penalties are money and the warnings
cascade. Model the rules as data, as validation rules already are (S-8), and read shift minutes from S-5's
Assignment/Staff capacity.

State: S-21 shipped (D-026). There is a crew/vendor portal at `/portal/call/<token>` and a producer page at
`/events/<id>/callsheets`. A receipt clears `awaitingReceipt`, and a portal COI is pending until it is
accepted on the budget page. SEC-04 and SEC-05 are fixed for both portals: the token is shown once as
form state, and a link expires 7 days after its event ends and is served with no-store, no-referrer and
noindex headers. 206 vitest pass. The e2e sweep is 29/29 on a production build.

Shane chose to build the P1s before closing the project (D-025). Still owed at closure: the exec brief and
the LinkedIn posts. DEMO.md exists; add the crew portal stop to it at closure.
