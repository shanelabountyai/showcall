# Next

**S-24 — P1-7 dietary and accessibility rollups for catering (counts, never names).** See `docs/backlog.md` P1.
Model pick: Opus (a privacy projection: counts must never leak a name, and D-018 says it reads S-14's
registration headcount). Sonnet is defensible if it turns out to be a pure rollup.

State: S-23 shipped (D-028). The client approves a budget snapshot through `/portal/client/<token>`, and the
latest approved snapshot is the baseline. Billable spend above it, compared line by line at
max(committed, actual), is listed on the budget page and blocks the close. Lines never wait on the client.
217 vitest pass. The e2e sweep is 31/31 on a production build.

Still owed at closure: the exec brief and the LinkedIn posts. DEMO.md exists. At closure, add the crew portal
stop, the rain call's overtime warning, and the client approval stop (the seed prints the client link; the
LED change order shows as $1,850 unapproved).
