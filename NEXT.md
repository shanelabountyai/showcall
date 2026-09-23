# Next

**S-21 — P1-3 vendor/crew portal.** A tokenized page showing the vendor's call sheet, COI upload, and a receipt
confirmation that clears P0-2's re-issue flag. See `docs/backlog.md` P1. Model pick: Opus, because the page is a
public token-gated surface. Reuse the S-8 portal token pattern and S-12 compliance. SEC-04/05 (the token in the
query string, no expiry) apply to it directly, so decide whether to fix them with it.

State: S-20 shipped. `/events/<id>/reconcile` has planned vs. actual from the GO log, final attrition, and the
budget close. The close is a final snapshot, and a trigger freezes the lines after it (D-025). 197 vitest pass;
the e2e sweep is 27/27 on a production build.

Shane chose to build the P1s before project closure (D-025). Still owed at closure: the exec brief and the
LinkedIn posts. DEMO.md already exists.
