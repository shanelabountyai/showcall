# Kickoff: Showcall Live (build log 11c, real-time run sheet)

Paste the block below into Claude Code started in `~/Projects/showcall`, on Opus
(`/model claude-opus-5-5`, per O-7). First merge the `live-kickoff` PR, or check out
that branch. The kit is docs only. No product code, migration or dependency exists for
live yet.

```
Showcall Live: real-time run sheet (build log 11c), a follow-on in this repo.
Postgres stays the source of truth. Every open run sheet, live-mode page, producer
call-sheets page and crew portal sees a committed change without reload.

Read, in order: CLAUDE.md, NEXT.md, docs/live/prd-showcall-live.md,
docs/decisions.md D-035 to D-047 and the "Open — Showcall Live" table (O-1 to O-7,
defaults in force), docs/live/brief.md, docs/live/phase-1-tasks.md. Then read the code
the tasks touch: src/runsheet/cascade.ts, src/live/live.ts,
src/callsheet/callsheet.ts, src/callsheet/portal.ts, src/content/lock.ts,
app/events/[eventId]/live/, proxy.ts, src/demo-gate.ts, prisma/schema.prisma,
e2e/showcall.spec.ts, playwright.config.ts. Read the Next 16 route-handler and
streaming guides in node_modules/next/dist/docs/ before planning L1.6.

Steps:
1. Baseline: npm ci, npm run db:migrate:all, npm test, then npm run test:e2e on the
   production build. Report the counts. If anything is red before you start, stop.
2. Check the docs against the code. List every place where a task names a function,
   table, column or behaviour that does not exist as described, or where two docs
   disagree. Don't resolve these yourself.
3. L1.0 needs me (Vercel CLI and the Preview env password). Write the exact commands
   you would run and what each of (a)–(e) would look like, then wait.
4. Plan: for S-27 to S-30, list the order of tasks, the failing test you will write
   first for each, every file you will create or change, and the migration SQL you
   will write for L1.1 and L1.3 (trigger bodies in full). Name the lock order you
   rely on and why it cannot deadlock. Say which tests prove seq order equals commit
   order.
5. Stop and show me the baseline counts, the contradictions list, the L1.0 commands
   and the plan. Do not write a migration, route, component or test before I approve.

Rules from the first commit:
- Postgres is the only truth. Frames are server projections at a seq.
- Nothing is written over the channel.
- No LISTEN/NOTIFY.
- No new dependency without asking (option A needs none).
- Never edit an expected value to pass a test.
- Hard rules 1–7 unchanged. Rule 7's sweep extends to stream frames.
- No ShowFileLock write under src/live or app/api/live.
- Clock injected, no bare new Date().
- Small commits naming files, never git add -A.
- Never push to main without my say. Push-to-deploy is off (D-033), and deploys go
  through the main-manual hook only when I ask.
- No "real-time", "instant" or "guaranteed" in a write-up without the measured number
  next to it.
```

## Still to do by hand

- Answer O-1 to O-7 at the plan gate (defaults stand if not), especially O-1 transport and
  O-3 crew on show day.
- L1.0: Vercel CLI preview deploy of the spike branch. Make sure `DEMO_ACCESS_PASSWORD` is
  set for the **Preview** environment before deploying (OPS-01), and delete the preview after.
- Confirm fluid compute is on for the `showcall` Vercel project (Settings → Functions).
  The API lookup from this session returned 404 for the project name in the visible team.
- Build-log card 11c: link the PRD and this PR. Status `kickoff`.
