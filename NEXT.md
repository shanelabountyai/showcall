# Next

**Showcall Live (build log 11c) is kicked off. Docs only, on branch `live-kickoff`.**
Start with `docs/live/KICKOFF.md`: the paste block stops at a plan gate before any code.

- PRD: `docs/live/prd-showcall-live.md` (stories LV-1 to LV-8).
- Research and transport options: `docs/live/brief.md` (read 2026-10-19).
- Decisions D-035 to D-047. **Open items O-1 to O-7, defaults in force.** O-1 transport
  default is **A: SSE from a route handler polling a per-show change seq in Postgres.**
  C (Ably, poke-only) is the upgrade path.
- Tasks: `docs/live/phase-1-tasks.md`, backlog S-27 to S-31.
- First: L1.0, the transport spike on a Vercel preview. It needs Shane (CLI and Preview
  env password).

Unverified, check in L1.0:
- fluid compute on the Vercel project;
- `EventSource` behind HTTP Basic on the deployed site;
- Playwright `setOffline` dropping an `EventSource`.

## Shipped project (closure 2026-09-25)

1. `docs/DEMO.md`: every stop checked against a running production build on a fresh seed.
2. Exec brief, *Showcall in Brief*: https://claude.ai/artifact/7s4pKXUT5Fanza7ZUvXBbE
   (private until shared; no screenshots, the app has no capture spec).
3. LinkedIn posts in the Ledger (https://claude.ai/artifact/Ai5xKScgT2sWtqXRQ1ZA8i):
   - post 60: Scale, time zones as instants, S-25;
   - post 61: Impact, consent checked at serve time, S-26;
   - post 62: Impact, approval check per line not total, S-23.

   Project chip "Showcall" added. Each post needs an image and is slotted so no adjacent
   drafts share a pillar. The Ledger's project chip list had no Showcall row before this.

For a new project elsewhere, port 4200 was the next free one at closure. Live uses this repo's 4000.

Live: https://showcall.labintelligence.co (D-032). HTTP Basic, any username. The password
is `DEMO_ACCESS_PASSWORD` in the gitignored `.env.deploy.local` (Sensitive in Vercel,
cannot be read back). Portal links on the live site: reissue in the app.
Production DB is Neon `showcall`. A reseed is `SHOWCALL_ALLOW_CLOUD_DB=1` with the direct
URL from `neonctl connection-string`, and it wipes first.
