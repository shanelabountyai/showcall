# Next

**Nothing left in the backlog. Showcall Live (S-27 to S-31) is done and merged to `main`.**
Pick a new project or item; port 4200 is the next free one (add its row to the global
table in the same commit as its config).

## ESLint added (2026-10-26, branch `add-eslint`)

`npm run lint` exists and runs in CI before typecheck (D-052). Open for the owner: the
budget-closed date prints `takenAt`'s UTC day (two suppressed lines name it), and the
speakers form stores a date input with `new Date(signed)`. The DB half of `npm test` did not
run in the cloud sandbox (no local Postgres credentials); CI is the gate.

## Showcall Live closure (2026-10-20/21)

Built on branches `live-kickoff`/`live-phase-1`, merged via PR #1 and #2, deployed and
measured. Full build notes are in the commit history and `docs/decisions.md` (D-035
onward); this is the closure summary.

- **What it does:** a per-show append-only change log drives one SSE stream per open
  view; a row editor previews and commits against `Cue.rev`, refusing a stale commit with
  `RowChanged`; crew portals get only their own role's projection. See WRITEUP.md's "Live
  run sheet" entry for the full design.
- **Gate (S-30):** CI green, 38/38 e2e, CI-runner latency p50 917 ms / max 941 ms.
- **Deployed and measured (S-31):**
  - Deployed latency: **p50 1553 ms, max 2770 ms** over 20 edits (target ≤ 2 s / ≤ 3 s).
  - Neon: ~27 min compute for a one-hour three-view demo (D-034's prior baseline was
    ~2.1 compute-hours/day from the old per-minute cron).
  - Vercel: **$0.055** for the whole test day (deploy + migrate + all three measurement
    runs combined — the usage API has no finer-than-a-day window).
  - O-4 (poll interval/stream life) and O-5 (Neon awake while a view is open) confirmed on
    their defaults (D-051) — nothing measured was close enough to a target to tune.
- **Two incidents hit and fixed along the way:**
  - D-049: the `main-manual` deploy hook builds and deploys but never migrates. Phase 1
    shipped ahead of its own migrations and the live site 500'd for ~5 hours until they
    were applied directly against production. **Standing rule: migrate, then deploy, never
    the reverse** — `docs/DEMO.md`'s live-site note and D-049 both say so now.
  - D-050: the production demo event's seed dates drift into the past on a normal
    calendar with no error or alarm — "Editing as" just quietly stops resolving anyone.
    Reseeded with today-dated data; redo before any live demo near a real audience date.
- **L2.3 is partial:** server logs confirm the deployed stream reconnects cleanly near its
  280 s design point with no errors, but the explicit 0-lost/0-duplicated assertion wasn't
  exercised (chip-attribute polling never caught a visible disconnect to anchor it to —
  would need a network listener instead of DOM polling to finish properly). Low priority;
  flag if it matters later.
- **This session's three standing Bash permission rules** for production access (the Neon
  connection string, `prisma migrate deploy`, and `prisma/seed.ts` against the cloud DB —
  the last one wipes all data first) were removed from `.claude/settings.local.json` after
  the fact, once noticed they'd persist silently across sessions. Production access goes
  back to asking each time; re-add deliberately if a future session needs it again.

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

Live: https://showcall.labintelligence.co (D-032). HTTP Basic, any username. The password
is `DEMO_ACCESS_PASSWORD` in the gitignored `.env.deploy.local` (Sensitive in Vercel,
cannot be read back). Portal links on the live site: reissue in the app.
Production DB is Neon `showcall`. A reseed is `SHOWCALL_ALLOW_CLOUD_DB=1` with the direct
URL from `neonctl connection-string`, and it wipes first.
