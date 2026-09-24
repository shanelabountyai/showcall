# Next

**Project closure.** The backlog is at zero: S-26 (P1-2, D-031) was the last P1. Model pick: Sonnet (docs and posts, no new logic).

State: S-26 shipped. The attendee package now carries locked decks, speakers' videos and session recordings. A recording
needs "record session" and "publish video" from every speaker on it. Each attendee gets a recap link (90 days after the show)
serving the last built package ∩ the consent-gated manifest now, so a withdrawal takes effect before any rebuild.
233 vitest pass; e2e 34/34 on a production build.

Closure owes (CLAUDE.md "Definition of done"):
1. DEMO.md: add the crew portal stop, the rain call's overtime warning, the client approval stop (the seed prints the client
   link; the LED change order shows as $1,850 unapproved), the kickoff's catering rollup (RFPs page: vegetarian 26, 22
   registered with no record), the portfolio calendar (home → Portfolio calendar: Sam Okafor 9h turnaround), and the
   recap stop (Packages → Lucia Varga's recording withheld; the seed prints Avery Chen's recap link, which shows Owen
   Castellano's recording). Run every command once.
2. Exec brief ("Showcall in Brief", exec-brief skill).
3. LinkedIn posts into the Ledger. Mine WRITEUP "Defects found": consent checked at serve time, not only at build time (S-26);
   comparing shifts as instants (S-25).
Record every artifact URL in docs/RELEASE_NOTES.md or here.

Live: https://showcall.labintelligence.co (D-032). HTTP Basic, any username; the password is in the gitignored
`.env.deploy.local` and is Sensitive in Vercel (cannot be read back). Portal links for the demo: reissue them in the app
(content page, call sheets, budget, packages → Attendee recap links), since the production seed's printed links were not kept.
Production DB is Neon `showcall` (restless-term-77017763); a reseed is `SHOWCALL_ALLOW_CLOUD_DB=1` with the direct URL from
`neonctl connection-string`, and it wipes first. Uploads over 4.5 MB fail on Vercel. DEMO.md and the brief should use the live URL.
