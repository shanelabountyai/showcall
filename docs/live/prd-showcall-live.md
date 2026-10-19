# PRD: Showcall Live — Real-Time Run Sheet (build log 11c)

> **Scope honesty.** A learning follow-on in a sample project. Synthetic data only: no real
> shows, crew, speakers or clients. The deployed copy sits behind one shared demo password
> (D-032). It has no user accounts (SEC-01 is open), so "who edited" is a name picked from
> the staff list, not an authenticated identity. Latency figures are measured at demo scale
> (≤ 10 open views) and say nothing about a real show with hundreds of devices. No claim is
> made of production readiness, delivery guarantees beyond those tested here, or any
> compliance.

**Status:** Draft v1.0, kickoff, 2026-10-19. Defaults are in force until Shane changes an
open item (O-1 to O-7 in `docs/decisions.md`).
**Parent:** `prd-showcall-event-production.md` (P0-2 run sheet and call sheets, live mode).
`docs/decisions.md` outranks both.
**Read with:** `docs/live/brief.md` (transport research, options table) and
`docs/live/phase-1-tasks.md`.
**Card:** "NEW: real-time collaboration, which no other project on the log covers."

## Problem

On show day the run sheet changes under people's feet. The keynote runs long, a producer
pushes the panel, and the A1 needs to know now. Showcall already derives every time from
anchors (D-006), cascades a change with a preview (D-023), and re-issues exactly the
affected call sheets (D-009). Every view of that work is still a page someone has to
reload. Live mode re-renders the whole page every five seconds (S-4). Nobody can edit a
single cue from the UI. If two producers do touch the same row, the second one's preview
silently stops matching, and the only thing they learn is "preview again".

The builder lesson the card names is **real-time collaboration with a database as the
source of truth**:

- fan-out to views that each see a different slice;
- ordering that matches commit order;
- catch-up after a drop with nothing lost and nothing applied twice;
- a recorded rule for two writers on one row;
- authorization that holds on the push path as well as on page loads.

## Goals

1. A committed change reaches every open run-sheet, live and producer call-sheet view in
   **≤ 3 s** (target ≤ 2 s), with no reload.
2. An issued call sheet reaches the open crew portal of every role it changes, and of no
   other role, in ≤ 3 s.
3. Two edits to the same row resolve by one recorded rule: the second is refused with the
   current row shown, and nothing the loser did is lost from their screen.
4. A view that drops and comes back shows the current state, and on producer views the
   changes it missed, each exactly once.
5. Role filtering, token expiry and the show-file lock are enforced by the server on every
   frame. They are proven by a sweep and a lock test, not by trusting the client.
6. **(Builder goal)** The transport is chosen against Vercel's documented limits before any
   code, with the trade-off written down (D-043, O-1), and measured on the deployed site.

## Non-goals

- Character-level co-editing, CRDTs, presence cursors or "who is typing". A row is the unit.
- Offline editing or queued writes. A disconnected view is read-only until it reconnects.
- Live push of **drafts** to crew. Crew get issued sheets (D-041).
- Pushing agenda-grid edits, budget, RFP, attrition or bureau pages. Live covers the run
  sheet, live mode, producer call sheets, the crew portal, and show-file lock state on the
  content and packages pages.
- Authentication (SEC-01). Live inherits the demo password and the portal tokens as they are.
- Mobile push notifications, SMS or email on change.
- Sub-second latency, or a guarantee at real-show scale (see the banner).
- Rebuilding packages or re-issuing sheets automatically (D-016 and D-009 stand).

## Personas

Producer (edits rows, issues sheets) · Second producer or coordinator (edits the same
show) · Stage manager (live mode, calls GO, one room or all rooms) · Crew or vendor role
(crew portal, one role's issued sheet) · Speaker (content portal; unchanged except that a
post-lock upload notifies producers).

## P0 stories

Each acceptance criterion maps to a task in `docs/live/phase-1-tasks.md`.

**LV-1 Row edit reaches every open view.** As a producer, I change a cue's start, offset,
duration or label from the run-sheet editor. Every open run-sheet, live and call-sheets
page for this show updates without reload.
- [ ] The editor previews the cascade (moved rows, problems, work-rule warnings) and commits
  through `commitCascade` with the preview as `expected` (D-006, D-023).
- [ ] Browser B, open on `/events/:id/runsheet`, shows the new time **and every cue
  anchored to it** within 3 s, with no navigation (two-browser e2e).
- [ ] Browser B's `/events/:id/callsheets` shows the affected roles flip to NEEDS RE-ISSUE
  live, and only those roles.
- [ ] A change that leaves a problem is refused whole, and no frame is sent (seq unchanged).

**LV-2 Two editors, one row.** As a second producer editing the same row, I learn my edit
did not land, see what did, and keep what I typed.
- [ ] Each row carries `rev`. A commit names the `rev` it was edited from. A mismatch is
  refused with `RowChanged`, naming who changed it and when, plus the current values
  (D-039).
- [ ] The refused editor keeps the loser's typed values in the form beside the current row.
  One click re-previews against the current row.
- [ ] Edits to *different* rows both land when neither moves what the other previewed. If
  one does move it, the existing `CascadeChanged` refusal applies and is shown in the same
  way.
- [ ] The `ShowChange` log has exactly one entry for the winning edit and none for the
  refused one.

**LV-3 Live mode without polling.** As a stage manager, I see GO calls from other rooms,
row edits and minute rollovers on my live page without the 5 s page refresh.
- [ ] A GO in Ballroom B reaches an open live page in Ballroom A within 3 s.
- [ ] Projected times update when a row goes overdue with nothing written (the stream sends
  on the minute rollover from the injected clock, D-046).
- [ ] `Poll` is removed from the live page while the stream is healthy, and comes back as
  the fallback when it is not (LV-7).

**LV-4 Catch-up after a drop.** As anyone whose connection drops, I come back to the
current state without reloading. I see what changed while I was gone once, never twice.
- [ ] Every frame carries `id: <changeSeq>`. The client ignores a frame whose seq ≤ the seq
  it holds (D-038).
- [ ] On reconnect, `Last-Event-ID` is read. If the show's seq is ahead, the current
  projection is sent at once. On producer views, the `ShowChange` rows in
  `(Last-Event-ID, seq]` are sent as a "while you were away" list.
- [ ] Reconnect e2e: browser A goes offline, browser B makes two edits, browser A comes
  back. A shows both edits once in the list and the final times in the sheet, with no
  duplicate rows (L1.9b).
- [ ] A stream closes itself before Vercel's max duration (default 280 s against 300 s,
  D-043). The reconnect is seamless: no visible flash, and no duplicate list entries.

**LV-5 Crew portal goes live, filtered.** As the A1 Audio role holding a portal link, I see
a re-issue of my sheet appear while the page is open. I never receive another role's cue
in any frame.
- [ ] `/api/live/call/:token` sends only `resolveCrewPortal(token)` output: the role's latest
  issued sheet and its changes since the previous issue (D-041).
- [ ] An issue that changes Catering and not A1 Audio produces a frame for Catering's
  portal and **no content change** for A1 Audio's. A1 Audio's stream may advance its seq,
  but its sheet is byte-identical.
- [ ] Leak sweep: for every role, over a scripted sequence of edits and issues, no frame on
  that role's stream contains a cue id, label or room that is not on that role's own
  projection (L1.9d). This is the existing hard-rule-7 sweep, extended to stream frames.
- [ ] A reissued (revoked) or expired link closes its open stream within one poll, and a
  reconnect gets 404.

**LV-6 Show-file locks hold on the channel.** As a producer with the content or packages
page open, I see an approve or override land live. A speaker's post-lock upload shows as
"v8 uploaded, show file still v7" and never as the show file.
- [ ] Lock state on every frame is read from the `ShowFileLock` pointer when the frame is
  sent (D-042).
- [ ] No live endpoint writes `ShowFileLock`. Approve and override stay server actions with
  their existing checks. The guard test enumerates `src/live/**` and `app/api/live/**`
  for lock writes (L1.8).
- [ ] Speaker and crew streams never carry content files or version metadata for
  deliverables that are not theirs. The speaker content portal does not get a stream in
  phase 1.

**LV-7 Degraded, never wrong.** As anyone, when the live channel cannot connect, I can
see that, and the page still works.
- [ ] A status chip shows `live`, `reconnecting…` or `offline: refreshing every 5 s`.
  After 3 failed reconnects the page falls back to the existing `Poll`.
- [ ] A hidden tab closes its stream (`visibilitychange`) and reopens on show, catching up
  as in LV-4. A tab left open overnight therefore does not hold a function instance or
  keep Neon awake (D-043).

**LV-8 The transport is decided before code.** As Shane, I see the options, the
recommendation and its trade-off, and a spike result from the deployed site before any
stream code merges.
- [ ] O-1 is recorded with its default (A) and the options table (brief §5).
- [ ] L1.0 spike: a throwaway SSE route on a preview deploy streams for 300 s behind the
  demo password and reconnects with `Last-Event-ID`. The result and the fluid-compute
  setting are written in NEXT.md before L1.5.

## Success metrics (measured, not adjectives)

- Latency, commit to frame in the other browser: p50 and max over 20 edits, local and
  deployed. Target ≤ 2 s p50, ≤ 3 s max.
- Catch-up: 0 lost and 0 duplicated changes over the reconnect fixture (exact counts in
  the test output).
- Leak sweep: 0 foreign cue ids across every role × every frame.
- Conflict: 1 winner, 1 `RowChanged`, 1 log row, every run.
- Cost (L2): Vercel function GB-hours and Neon compute hours for a one-hour demo with
  3 views open, against D-034's baseline of about 2.1 compute hours a day.

## Phasing

- **Live phase 1 (S-27 to S-30): the channel, locally proven.** Change log and seq, row
  editor with the conflict rule, the SSE stream for producer, SM and crew views, lock state,
  and the four e2e tests on the production build. Exit: `docs/live/phase-1-tasks.md` exit
  criteria.
- **Live phase 2 (S-31): deployed and measured.** Deploy through the `main-manual` hook
  (D-033), measure latency and cost, add a DEMO.md stop, and write WRITEUP verdicts.
- **Live phase 3 (optional, only if O-1 moves): transport swap** to C behind the same
  `LiveSource` seam, with the four e2e tests unchanged.

Rule, as in the parent PRD: no phase advances while the prior gate fails.
