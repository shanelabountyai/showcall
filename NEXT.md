# Next

**S-23 — P1-6 client approval gates on budget and scope changes.** See `docs/backlog.md` P1. Model pick:
Opus (money and approval gates). A change a client must sign off on waits until they approve it. The budget
close (D-025) and snapshots (S-12) are where it hooks in.

State: S-22 shipped (D-027). `CrewRules` (one per event) drives crew work-rule warnings on every cascade
result (`warnings`, each `isNew`) and on the call-sheets page. They are never refusals. The shift is a call
role's call to wrap. 212 vitest pass. The e2e sweep is 29/29 on a production build.

Shane chose to build the P1s before closing the project (D-025). Still owed at closure: the exec brief and
the LinkedIn posts. DEMO.md exists; at closure add the crew portal stop and the rain call's overtime warning.
