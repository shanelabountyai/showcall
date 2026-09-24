# Next

**S-25 — P1-4 portfolio calendar with cross-event staff conflicts.** See `docs/backlog.md` P1.
Model pick: Opus (the PRD flags it as the hardest P1: cross-event constraint checking).

State: S-24 shipped (D-029). Attendee records (name, email, type, needs from a fixed `Need` list) sit
under the registration. Catering sees `rollup` (src/rfp/needs.ts): event-wide counts, never names and
never split by type, plus how many registered have no record. It shows on the RFP page and on the crew
portal of the role whose vendor holds the event's catering contract. 221 vitest pass. e2e is 32/32 on a
production build.

Still owed at closure: the exec brief and the LinkedIn posts. DEMO.md exists. At closure, add the crew portal
stop, the rain call's overtime warning, the client approval stop (the seed prints the client link; the
LED change order shows as $1,850 unapproved), and the kickoff's catering rollup (RFPs page: vegetarian 26,
22 registered with no record).
