# Next

**Project closure: all 3 deliverables done (2026-09-25).**

1. `docs/DEMO.md` — every stop checked against a running production build on a fresh seed.
2. Exec brief, *Showcall in Brief*: https://claude.ai/artifact/7s4pKXUT5Fanza7ZUvXBbE (private until shared; no screenshots, the app has no capture spec).
3. LinkedIn posts in the Ledger (https://claude.ai/artifact/Ai5xKScgT2sWtqXRQ1ZA8i): posts 60 (Scale, time zones as instants, S-25), 61 (Impact, consent checked at serve time, S-26), 62 (Impact, approval check per line not total, S-23). Project chip "Showcall" added. Each needs an image and is slotted so no adjacent drafts share a pillar. The Ledger's project chip list had no Showcall row before this.

Nothing left in the backlog. Pick a new project or item; port 4200 is the next free one (add its row to the global table in the same commit as its config).

Live: https://showcall.labintelligence.co (D-032). HTTP Basic, any username; password `DEMO_ACCESS_PASSWORD` in the
gitignored `.env.deploy.local` (Sensitive in Vercel, cannot be read back). Portal links on the live site: reissue in the app.
Production DB is Neon `showcall`; a reseed is `SHOWCALL_ALLOW_CLOUD_DB=1` with the direct URL from `neonctl connection-string`, and it wipes first.
