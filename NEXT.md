# Next

**Project closure: all 3 deliverables done (2026-09-25).**

1. `docs/DEMO.md` — every stop checked against a running production build on a fresh seed.
2. Exec brief, *Showcall in Brief*: https://claude.ai/artifact/7s4pKXUT5Fanza7ZUvXBbE (private until shared; no screenshots, the app has no capture spec).
3. LinkedIn posts in the Ledger (https://claude.ai/artifact/Ai5xKScgT2sWtqXRQ1ZA8i): posts 60 (Scale, time zones as instants, S-25), 61 (Impact, consent checked at serve time, S-26), 62 (Impact, approval check per line not total, S-23). Project chip "Showcall" added. Each needs an image and is slotted so no adjacent drafts share a pillar. The Ledger's project chip list had no Showcall row before this.

## Backlog (added 2026-10-01)

1. **Real-time run sheet (live shared state).** Source: Build Log gap review; no project on the log covers real-time collaboration, and the run sheet is the natural host.
   - Every open screen (run sheet and role-filtered call sheets) shows a cue change as it happens, with no reload.
   - Two people editing the same row resolve cleanly: decide the rule (last write wins per field, or reject on stale version) and record it as a D- decision.
   - Reconnect after a dropped connection catches the client up without losing or duplicating a change.
   - Role filtering holds on the live channel: a call sheet never receives rows its role cannot see.
   - Show-file locks still win: a locked item rejects a live edit the same way it rejects a saved one.
   - Test with two browser sessions against one seed; add the stop to `docs/DEMO.md`.
   - Open question: transport. Confirm what the Vercel deployment supports (WebSockets, SSE, polling, or a hosted channel) and pick one before any code.

For a new project, port 4200 is the next free one (add its row to the global table in the same commit as its config).

Live: https://showcall.labintelligence.co (D-032). HTTP Basic, any username; password `DEMO_ACCESS_PASSWORD` in the
gitignored `.env.deploy.local` (Sensitive in Vercel, cannot be read back). Portal links on the live site: reissue in the app.
Production DB is Neon `showcall`; a reseed is `SHOWCALL_ALLOW_CLOUD_DB=1` with the direct URL from `neonctl connection-string`, and it wipes first.
