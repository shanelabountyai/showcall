# Showcall Live — phase 1: the channel, proven locally (S-27 to S-30)

Reads: `docs/live/prd-showcall-live.md`, D-035 to D-047 and O-1 to O-7 in
`docs/decisions.md`, `docs/live/brief.md`. One backlog item per session (S-27, S-28,
S-29, S-30), as for every item in this repo. The TDD order for live:
seq trigger → conflict rule → stream frame builder → catch-up → leak sweep. Write the
failing test first, every time. Nothing here changes a hard rule.

Gate at the end of each item: `npm test` green. Then the full e2e sweep on a production
build (`npm run test:e2e`, D-024): live specs and the existing story spec, both green.
Then the backlog row ✅, a WRITEUP entry, NEXT.md for the next item, small commits
naming files (never `git add -A`), and push.

## L1.0 Transport spike (before S-27, no product code) — needs Shane

On a throwaway branch, add one route, `app/api/spike/sse/route.ts`. It streams
`id: n` every second for 300 s, with `export const maxDuration = 300`. Deploy it as a
**preview** with the Vercel CLI (push-to-deploy is off, D-033). The proxy gate must cover
the preview: `DEMO_ACCESS_PASSWORD` has to be set for the Preview environment (OPS-01),
or the spike is not deployed. Confirm in the dashboard that fluid compute is on.

*Acceptance:* NEXT.md records:
- (a) fluid compute on or off;
- (b) whether `EventSource` in Chrome connects behind HTTP Basic without a second prompt;
- (c) the second the stream was cut;
- (d) that reconnect sent `Last-Event-ID`;
- (e) the preview deleted afterwards.

If (b) fails, stop. The fallback is a same-origin `fetch` stream reader in place of
`EventSource`, which carries credentials the same way pages do. Record it as D-048
before L1.5. The spike branch is deleted, never merged.

## S-27 — change log and sequence

- [ ] **L1.1 Migration: `changeSeq`, `ShowChange`, `bump_show_change`, triggers (D-037).**
  Hand-written SQL in a Prisma migration:
  - `Event.changeSeq Int @default(0)`.
  - `ShowChange(id, eventId, seq, txid bigint, kinds text[], actor text, at timestamptz)`,
    unique on `(eventId, seq)` and `(eventId, txid)`, append-only by trigger. The `kinds`
    append is the one permitted update, from the bump function, the way D-026 lets
    `docId` be set once.
  - The function, and AFTER INSERT/UPDATE/DELETE triggers on `Cue`, `CueRole`,
    `LiveMark`, `CallSheetIssue`, `CallSheetReceipt`, `AgendaVersion`, `ShowFileLock`,
    `ContentVersion` (event resolved through `Deliverable`), plus `Event` when
    `runSheetVersion` changes. The `Event` trigger must not recurse on its own
    `changeSeq` update.
  - `actor` comes from `current_setting('showcall.actor', true)`, or `''`.

  *Acceptance (vitest, `showcall_test`):*
  - (i) a cascade commit moving several cues writes exactly one `ShowChange` and bumps the
    seq by 1;
  - (ii) two concurrent transactions on one event produce seqs that match commit order.
    Hold tx 1 open after its write, start tx 2, commit tx 1 then tx 2: seqs are 1 then 2,
    and a reader between the commits sees 1 only;
  - (iii) a refused cascade (`CascadeBlocked`) leaves the seq unchanged;
  - (iv) `UPDATE`/`DELETE` on `ShowChange` is refused;
  - (v) writes on two events give independent sequences;
  - (vi) a portal upload after lock bumps the seq of the deliverable's event.
- [ ] **L1.2 Writers inside transactions.** `issueCallSheets` takes the event lock and issues
  in one transaction. This replaces the `ponytail:` comment, and a concurrent second issue
  now waits and then issues nothing. `markGo` writes inside a transaction. *Acceptance:*
  two concurrent `issueCallSheets` calls issue each changed role once, and the second
  returns `[]`. The existing callsheet, portal and live suites stay green unchanged.

## S-28 — row editor and the conflict rule

- [ ] **L1.3 `Cue.rev` and `RowChanged` (D-039).** The migration adds `rev Int @default(0)`,
  bumped by a BEFORE UPDATE trigger on `Cue`. `CueEdit` gains `rev?: number`. Inside
  `applyChange`, under the event lock and before the update, a mismatch throws
  `RowChanged { cueId, current: CueSpec, by, at }`. `by` and `at` come from the last
  `ShowChange` whose kinds include that cue. To get that, the bump stores
  `cue:<id>` kinds. *Acceptance (unit):*
  - (i) two editors load `rev` 0; A commits; B is refused with `RowChanged` naming A's
    actor; the seq bumped once; one log row;
  - (ii) edits to two different, unrelated rows both land;
  - (iii) A's edit to row 1 moves row 2's anchored dependant, which B previewed. B's
    commit to row 2 is refused `CascadeChanged`, not `RowChanged`, and nothing is written;
  - (iv) a rebase between B's load and commit is a `CascadeChanged`, not a `RowChanged`.
- [ ] **L1.4 `/events/:id/runsheet` editor + "Editing as" (D-044, D-045).** List rows in
  run-sheet order. Each cue row is a form (label, duration, offset, fixed day/start, or
  anchor/edge) with a hidden `rev`, a Preview button (moved rows, problems, new
  warnings), and a Commit that carries the preview as `expected`. The editor offers a
  "commit and issue changed sheets" tick, unchecked (O-3). The picker lists today's or
  pre-show `producer`/`stage_manager` assignments. The action re-checks the pick and sets
  `showcall.actor` with `SET LOCAL` through `set_config(…, true)` inside the commit's
  transaction. `RowChanged` re-renders the form with the refused values beside the
  current row and a "re-preview against current" button. Nav link added in the event
  layout. *Acceptance:*
  - an edit with no picker value is refused, named;
  - an edit as a staffer with no assignment is refused;
  - a refused edit's typed values survive the re-render (e2e in L1.9c).

## S-29 — the stream

- [ ] **L1.5 `src/live/stream.ts`: the frame builder and the loop (D-038, D-043, D-046).**
  Pure core: `nextFrame(held: number, current: number, minuteRolled: boolean)` decides
  whether to send. `buildFrame(kind, key, tx)` reads `changeSeq` and the projection in one
  `REPEATABLE READ` transaction. `loadRunSheet`, `callSheetStatus`, `liveShow` and
  `resolveCrewPortal` take an optional `tx` to make that possible: a signature change
  only, with behaviour unchanged and existing tests green. `LiveSource.waitForChange` is
  the poll (`LIVE_POLL_MS`). `streamResponse(…)` returns a `ReadableStream` that:
  - writes `retry: 2000`;
  - sends the first frame at once if `Last-Event-ID` < seq, or if there is no
    `Last-Event-ID`;
  - then sends on each seq move, plus each minute for `live`;
  - sends a `: keepalive` comment every 15 s;
  - closes at `LIVE_MAX_MS`, and on `request.signal` abort.

  The clock is injected, so there is no bare `new Date()`. *Acceptance (unit, fixedClock):*
  - (i) the frame sequence for a scripted series of writes is strictly increasing in seq
    with no repeats;
  - (ii) resuming with `Last-Event-ID` = 3 when the seq is 5 sends one frame (seq 5) plus,
    for producer kinds, a `missed` list of exactly seqs 4 and 5;
  - (iii) resuming at the current seq sends nothing until the next change;
  - (iv) a minute rollover on `live` sends a frame with an unchanged seq;
  - (v) the loop stops at `LIVE_MAX_MS`;
  - (vi) the frame and seq come from one snapshot. Commit a write between the seq read and
    the projection read in a test hook: the frame still shows the pre-write state.
- [ ] **L1.6 Routes (D-040).** `app/api/live/[eventId]/runsheet/route.ts`,
  `…/live/route.ts`, `app/api/live/call/[token]/route.ts`. Read the Next 16 route-handler
  and streaming guides in `node_modules/next/dist/docs/` first. Each has
  `dynamic = 'force-dynamic'`, `maxDuration = 300`, and headers
  `Content-Type: text/event-stream`, `Cache-Control: no-store`, and for crew
  `Referrer-Policy: no-referrer`. The crew route re-resolves its token each poll and
  closes on null. `proxy.ts` is unchanged: `/api/live/**` is behind the demo password
  like every page. *Acceptance:*
  - a bad or expired token returns 404 before any byte;
  - a revoked token mid-stream closes within `LIVE_POLL_MS` + 100 ms (unit, with a fake
    source);
  - no route accepts a role, room or audience parameter from the client (test reads each
    route's exports).
- [ ] **L1.7 Client: `app/live-stream.tsx` (`useLiveStream`) and the status chip
  (PRD LV-4, LV-7).** Built on `EventSource`, or the fetch reader if L1.0 says so. It:
  - holds the seq and drops frames ≤ it;
  - replaces state on an equal-seq minute frame for `live`;
  - shows `live`, `reconnecting…`, or `offline: refreshing every 5 s`. After 3 failed
    reconnects it mounts the existing `Poll`;
  - closes on `document.hidden` and reopens on show;
  - renders the `missed` list once per reconnect, dismissible.

  Wire it into the run-sheet editor (L1.4), live mode (remove the unconditional `Poll`),
  producer call sheets, and the crew portal. *Acceptance:* covered by L1.9. Also, a
  component test that a replayed frame at an equal seq does not re-append `missed`
  entries.
- [ ] **L1.8 Lock state on the content and packages pages (D-042).** Their stream frame
  carries each deliverable's latest version number and show-file pointer, read when the
  frame is built. *Acceptance:*
  - (unit) after `approve` v7, a portal upload v8 produces a frame showing
    `latest 8, showFile 7`; only `override` moves `showFile`;
  - (guard) a test greps `src/live/**` and `app/api/live/**` for `showFileLock.create`,
    `showFileLock.update`, `approve(` and `override(`, and finds none.

## S-30 — the live gate (e2e on the production build)

New file `e2e/live.spec.ts`, serial. It reseeds (`execSync('npm run db:seed:test')`) in
both `beforeAll` and `afterAll`, the S-19 precedent, so it leaves `showcall.spec.ts` a
fresh seed in either file order. Two browsers means two `browser.newContext()` in one test.

- [ ] **L1.9a Live update, two browsers (LV-1, LV-5).**
  - A opens `/runsheet` as producer 1. B opens `/runsheet`, and C opens A1 Audio's crew
    portal.
  - A moves "Doors" 10 min and commits. Within 3 s, with no navigation, B shows Doors
    and its anchored dependants at the new times, and B's call-sheets tab shows only the
    affected roles NEEDS RE-ISSUE.
  - A issues. If A1 Audio was affected, C shows the new issue number within 3 s. A role
    that was not affected shows no change.
  - Assert no `page.goto` or `reload` between the action and the expectation, by
    checking `page.url()` and the navigation count.
- [ ] **L1.9b Reconnect catch-up (LV-4).**
  - A opens `/runsheet`. A goes offline (`context.setOffline(true)`, or the test-only
    `?dropAfter=` close if L1.0 found offline does not drop `EventSource`).
  - B commits two edits to different rows. A comes back online.
  - Within 5 s, A's sheet shows both edits. Its "while you were away" list has exactly 2
    entries, naming B's actor.
  - Then A is offline and online again with no new edits: the list does not grow and the
    sheet is unchanged (no duplication).
- [ ] **L1.9c Concurrent edit conflict (LV-2).**
  - A and B open the same cue row, both at `rev` 0.
  - A sets start 10:05 and commits. B, without reloading, sets start 10:20 and commits.
  - B sees `RowChanged` naming A's actor. Its form still holds 10:20. The current row
    shows 10:05.
  - B clicks "re-preview against current", commits, and lands 10:20.
  - The `ShowChange` count rose by exactly 2 across the whole test, read from a
    test-only count on the run-sheet page or from the DB in the spec through
    `execSync('psql …')`.
- [ ] **L1.9d Role-filter leak (LV-5, hard rule 7).** Open the crew portal stream for every
  seeded role (the seed's portal links, or reissue in a setup step), capturing raw frames
  with `page.on('response')`, or by reading the SSE body with `request.get` and a 10 s
  read. Run a script: move a cue tagged to Catering only, issue, then move a cue tagged to
  A1 Audio only, and issue. For each role, assert that every captured frame contains only
  cue ids from that role's own issued sheets. The foreign-label list is built from the
  seed exactly as the unit sweep does in `callsheet.test.ts`. *Acceptance:* zero foreign
  hits. The test fails red on purpose first: temporarily build the crew frame with
  `loadRunSheet` in place of `resolveCrewPortal` on a scratch branch. Record the red run
  in NEXT.md.
- [ ] **L1.10 Latency number.** The two-browser test logs commit-to-visible ms for 20
  edits. Print p50 and max, and paste them into WRITEUP's entry. No adjective without the
  number.
- [ ] **L1.11 Docs.**
  - A WRITEUP.md entry, "Live run sheet (11c)": problem, what it does, what it
    deliberately does not do, and a verdict on producer review "a change reaches the
    room" (validated, changed, or cut).
  - DEMO.md gets a two-window stop.
  - Backlog rows S-27 to S-30 ✅.
  - NEXT.md names S-31.

**Exit criteria (live phase 1):**
- L1.1–L1.8 unit acceptance green in CI.
- L1.9a–d green on `npm run test:e2e` against the production build, alongside the
  unchanged `showcall.spec.ts`.
- p50 ≤ 2 s and max ≤ 3 s locally over 20 edits.
- Zero foreign ids in the leak sweep.
- No `ShowFileLock` write under live paths.
- O-1 to O-7 each confirmed or changed by Shane, with a dated line.

**Before S-31:** write `docs/live/phase-2-tasks.md`, covering:
- deploy through the `main-manual` hook;
- latency on the deployed site;
- function GB-hours and Neon compute hours for a one-hour demo with three views, against
  D-034's 2.1 h/day baseline;
- the 280 s reconnect seen in the wild;
- a decision on O-4 and O-5 from those numbers.

Then stop for review.
