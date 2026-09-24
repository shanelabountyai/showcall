# Next

**S-26 — P1-2 post-show asset distribution to attendees, consent-gated.** See `docs/backlog.md` P1. Last P1.
Model pick: Opus (hard rule 6: consent gates are structural; no code path distributes an unreleased asset).

State: S-25 shipped (D-030). `/calendar` lists events by date, cross-event staff conflicts, and people on
several events. `assign` now compares shifts as instants (`instantOf`, src/time.ts), checking the day on each
side. Turnaround under 10h between different events is a warning (src/staffing/portfolio.ts). Seed adds
Northwind West Roadshow (LA): Sam Okafor, 9h rest after the kickoff. 226 vitest pass; e2e 33/33 on a production build.

Still owed at closure: the exec brief and the LinkedIn posts. DEMO.md exists. At closure, add the crew portal
stop, the rain call's overtime warning, the client approval stop (the seed prints the client link; the
LED change order shows as $1,850 unapproved), the kickoff's catering rollup (RFPs page: vegetarian 26,
22 registered with no record), and the portfolio calendar (home → Portfolio calendar: Sam Okafor 9h turnaround).
