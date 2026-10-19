# Next

**Showcall Live phase 1 (S-27 to S-30) is built on branch `live-phase-1`, PR #2 into
`live-kickoff` (not merged).** Shane approved building it unattended on a branch (2026-10-19), skipping
the plan gate's wait but not its plan: the plan is below, written before any code.
O-1 to O-7 are built on their defaults (A: SSE + seq poll; reject-and-refresh per row;
issued sheets only for crew, tick off; 1000 ms / 280 000 ms / 300 s; Neon awake while
open; producer or SM by "Editing as"). No default was changed.

## Environment this was built in

The build container cannot download Prisma engine binaries (network policy), so
`prisma generate`, migrations and every DB-backed test ran **only in GitHub CI**. Pure units
(`src/live/stream.test.ts`, `src/live/client-state.test.ts`) ran locally too. Typecheck
locally ran with the generated client missing, so Prisma-typed code was checked in CI only.

## Plan (written first, 2026-10-19)

### Contradictions and gaps found reading docs against code (not resolved by me unless noted)

1. **CI does not run Playwright.** `.github/workflows/ci.yml` runs migrate, typecheck and
   vitest only; the phase gate needs `npm run test:e2e` green. Added an `e2e` job
   (production build, `LIVE_TEST_HOOKS=1`) rather than change the gate.
2. **`bump_show_change(eventId, kind)`** takes one kind; L1.3 needs `cue:<id>` kinds as well
   as `cue`. Built as `bump_show_change(event_id, VARIADIC kinds text[])`.
3. **`ShowChange.at` cannot come from the injected clock**: a trigger cannot see it.
   It is the database's `now()` (transaction start). Display only; no rule reads it.
   Recorded as D-048.
4. **`EventSource` cannot send `Last-Event-ID` on its first connect**, only on its own
   reconnects. The page renders frame N server-side, so the client opens the stream with
   `?since=N`; the header wins when present. `since` is a seq, not an audience, so the
   "no role/room/audience parameter" rule holds (the test allows exactly `since` and
   `dropAfter`). Recorded in D-048.
5. **L1.7's "component test"** has no React test library and no new dependency is
   allowed. The frame reducer is a pure module (`src/live/client-state.ts`) and is what
   the test drives; the hook is a thin shell over it.
6. **`CueRole` cannot always resolve its event through `Cue`**: a cue delete cascades to
   `CueRole` after the cue row is gone. The trigger resolves through `CallRole.eventId`.
7. **vitest only collects `src/**/*.test.ts` and has no `@/` alias.** Route modules
   under `app/api/live/` therefore import with relative paths so the leak sweep can import
   the real `GET`.
8. **L1.0 (spike on a Vercel preview) needs Shane** and is skipped here. L1.5/L1.7 are
   built on `EventSource` as the default; if L1.0(b) fails, D-048's fetch-reader fallback
   is still to do.

### Lock order (why nothing deadlocks)

`Event` is the only lock the bump takes, and it is always the **last** lock a transaction
takes: the cascade, `insertCue`, `issueCallSheets` and `recheck` take `Event FOR UPDATE`
first and nothing else after it; `approve`/`override`/`submitVersion` take `Deliverable
FOR UPDATE` and then `Event` (through the trigger); `markGo`, receipts and publishes take
only `Event` (through the trigger). FK inserts take `KEY SHARE` on `Event`, which does not
conflict with the bump's `NO KEY UPDATE`. Nothing takes `Event` and then `Deliverable`.
So the graph is `Deliverable → Event`, acyclic.

### Order, the failing test first, and what each proves

| # | Task | Failing test first | Proves |
|---|---|---|---|
| 1 | L1.1 migration `show_change_log` | `src/live/changes.test.ts` (i)–(vi) | one row and +1 per transaction; **seq order = commit order** ((ii): tx 2 blocks on the event row until tx 1 commits, a reader between the commits sees 1); refusal leaves seq; append-only; per-event sequences; upload after lock bumps the deliverable's event |
| 2 | L1.2 issue + GO in transactions | `callsheet.test.ts` concurrent issue | two concurrent issues: each changed role once, second returns `[]` |
| 3 | L1.3 `Cue.rev`, `RowChanged` | `src/runsheet/conflict.test.ts` (i)–(iv) | reject-and-refresh names the winner's actor; different rows both land; a moved dependant or a rebase is `CascadeChanged`, never `RowChanged` |
| 4 | L1.4 editor + "Editing as" | `src/runsheet/editor.test.ts` | no actor refused, an unassigned staffer refused, the actor lands on the log row |
| 5 | L1.5 `src/live/stream.ts` | `src/live/stream.test.ts` (pure, fake source) + `src/live/frames.test.ts` (DB) | strictly increasing seqs; resume 3→5 sends one frame with missed [4,5]; resume at seq sends nothing; minute frame keeps seq; closes at max; 12 streams on a 10-connection pool while a page read completes; frame and seq from one snapshot |
| 6 | L1.6 routes | `src/live/routes.test.ts` | bad token 404 before a byte; revoked token closes within poll+100 ms; no audience params; `dropAfter` inert without `LIVE_TEST_HOOKS=1` |
| 7 | L1.7 client | `src/live/client-state.test.ts` | drop seq ≤ held; equal-seq minute frame replaces on live; a replayed frame does not re-append missed |
| 8 | L1.8 lock state | `src/live/locks.test.ts` | v7 approved, v8 uploaded → frame shows latest 8 / showFile 7; only override moves it; grep guard finds no lock write under live paths |
| 9 | L1.9a–d, L1.10 | `e2e/live.spec.ts` + `src/live/sweep.test.ts` | two-browser update, reconnect catch-up (2 entries, no growth), conflict (+2 log rows), leak sweep on frames from the real crew `GET`, latency p50/max over 20 edits |
| 10 | L1.11 | — | WRITEUP entry, DEMO stop, backlog ✅, this file names S-31 |

### Migration SQL (L1.1, L1.3), in full in the migration files

- `20261019120000_show_change_log/migration.sql`: `Event.changeSeq`; `ShowChange`;
  `bump_show_change(event_id, VARIADIC kinds)`; `show_change_append_kinds` (append-only
  except the writing transaction appending kinds); one trigger function per table
  resolving the event (`Cue`, `CueRole` via `CallRole`, `LiveMark`, `CallSheetIssue` via
  `CallRole`, `CallSheetReceipt` via issue and role, `AgendaVersion`, `ShowFileLock` and
  `ContentVersion` via `Deliverable`, `Event` on `runSheetVersion` with a `WHEN` guard so
  its own `changeSeq` update does not recurse).
- `20261019130000_cue_rev/migration.sql`: `Cue.rev` and a BEFORE UPDATE trigger
  `NEW.rev := OLD.rev + 1`.

## Result (2026-10-19)

Built: L1.1–L1.8, L1.9a–d, L1.10, L1.11 (WRITEUP entry, DEMO "two windows" stop,
backlog rows). Skipped: **L1.0** (needs Shane). Not written: `docs/live/phase-2-tasks.md`
(the kit writes it after review).

CI on PR #2 (`live-phase-1` → `live-kickoff`), last green-for-live run **39320395646**
(51defba):
- `ci` job (migrate, typecheck, all vitest incl. Postgres suites): **success**.
- `e2e` job: all 4 `e2e/live.spec.ts` tests **passed**; `e2e/showcall.spec.ts` fails at
  "content turn-in … issues a link" (line 146) and the 24 serial tests after it do not run.
  **This failure predates the branch:** re-running the baseline commit 4f69f23 (plan +
  CI job only, no product code) failed e2e too (run 39315104250, attempt 2), while its
  first attempt an hour earlier passed. It looks time-of-day dependent; not touched here
  ("fix only what your change broke"). Needs a look before S-30 can be ✅.
- Latency (L1.10, CI runner, production build): **p50 917 ms, max 941 ms** over 20 edits.
- **L1.9d red run:** commit 828f4e0 built crew frames from `loadRunSheet`; CI run
  **39320828222** `ci` job failed in vitest at `src/live/sweep.test.ts` (the role's
  stream never carried its issued sheet). Reverted in 4efdde4. The in-test negative
  control also shows the string check catching a leaky frame on every run.

Locally verified without a database: pure units (`stream`, `client-state`), and the
client against a production Next build with a fake stream in a local Chromium:
EventSource catch-up after an offline drop (2 missed, none duplicated), and the row
editor's conflict / re-preview flow. That probe found the controlled-select reset bug.

## L1.0 spike result (2026-10-19, run by Shane in Chrome on the Mac)

Route `app/api/spike/sse/route.ts` on throwaway branch `spike/sse` (958d117, deleted after),
deployed as a Vercel **preview** with the CLI; `DEMO_ACCESS_PASSWORD` set for Preview.
- (a) Fluid compute: **on** (Settings → Functions).
- (b) `EventSource` connected behind HTTP Basic **with no second prompt** — the D-048
  fetch-reader fallback is not needed; L1.5/L1.7 stay on `EventSource`.
- (c) The platform cut each stream at about **300 s** (`maxDuration` 300; the spike did not set
  `LIVE_MAX_MS`): ids 1–~300 on the first connection, ~301–600 on the second.
- (d) Reconnect sent `Last-Event-ID` (the route echoed `lastEventIdHeader: "600"` and resumed
  at `n` 601, `secondsOpen` reset), with no gap in ids.
- (e) Preview deletion: Shane's step (Needs Shane).
O-1 to O-7 confirmed by Shane, defaults kept (decisions.md, dated line).

## Needs Shane

- (e) Delete the spike preview `showcall-j4s3wtlcy-…vercel.app`: `vercel remove <url>` (L1.0 below).
- Latency on the deployed site, and cost against D-034 (S-31).
- The pre-existing `showcall.spec.ts` content turn-in failure in CI.
- Local runs: add `LIVE_TEST_HOOKS=1` to `.env.test` (the reconnect e2e needs `?dropAfter=`).

## Next item

**S-31** (live phase 2): write `docs/live/phase-2-tasks.md` first (deploy via the
`main-manual` hook, deployed latency, GB-hours and Neon hours for a one-hour demo with
three views, the 280 s reconnect in the wild, O-4/O-5 from those numbers), then stop for
review.

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
