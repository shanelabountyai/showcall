# Next

**Project closure, items 1 and 2 of 3 done.** Exec brief: https://claude.ai/artifact/7s4pKXUT5Fanza7ZUvXBbE (private until shared; no screenshots, the app has no capture spec). DEMO.md has the Phase 5 stops (crew portal, overtime warning, client approval,
catering rollup, portfolio calendar, recap), each checked against a running production build on a fresh seed.
Model: Sonnet (docs, posts).

Owes (CLAUDE.md "Definition of done"):
3. LinkedIn posts into the Ledger (https://claude.ai/artifact/Ai5xKScgT2sWtqXRQ1ZA8i). Mine WRITEUP "Defects found":
   consent checked at serve time, not only build time (S-26); comparing shifts as instants (S-25).
Record every artifact URL in docs/RELEASE_NOTES.md or here.

Live: https://showcall.labintelligence.co (D-032). HTTP Basic, any username; password `DEMO_ACCESS_PASSWORD` in the
gitignored `.env.deploy.local` (Sensitive in Vercel, cannot be read back). Portal links on the live site: reissue in the app.
Production DB is Neon `showcall`; a reseed is `SHOWCALL_ALLOW_CLOUD_DB=1` with the direct URL from `neonctl connection-string`, and it wipes first.
