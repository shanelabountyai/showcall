# Showcall Live — domain and technical brief

Build log item 11c, a follow-on in this repo. Read with `docs/live/prd-showcall-live.md`
and D-035 to D-047 in `docs/decisions.md`. Research read on **2026-10-19**. Every
vendor figure below carries its source, and a figure is only as current as that date.

## 1. What already exists, and what that means for live

| Today (as built) | Where | What it means for live |
|---|---|---|
| The run sheet is cue specs plus a pinned agenda version. Times are derived, never stored (D-006). | `src/runsheet/cascade.ts` | A live message cannot be "cue X is now 10:15". It has to be the resolved projection, because one edit moves every cue anchored to it. |
| Every run-sheet write goes through `applyChange` or `insertCue`/`recheck` under `SELECT … FOR UPDATE` on the `Event` row. | `cascade.ts` `lockEvent` | Run-sheet writes for one show are already serialised. A per-show counter bumped under that lock comes out in commit order at no extra cost (D-037). |
| Commit refuses unless it moves exactly what the preview showed (`CascadeChanged`). | `cascade.ts` | This is already a sheet-wide optimistic check. The row-level conflict rule (D-039) adds to it and does not replace it. |
| **No producer UI edits a single cue.** Cues change through rebase (live page), contingency branches (S-17) and the seed. | `app/…/live/page.tsx`, `src/contingency` | "Two people editing the same row" needs a row editor. It is in scope (D-045). |
| Live mode polls: `router.refresh()` every 5 s re-renders the whole server page. | `app/…/live/poll.tsx` | This is the baseline to beat, and the fallback if the stream is down. |
| GO is an append-only `LiveMark`. The offset derives from marks **and the clock**. | `src/live/live.ts` (D-010) | Projected times change when nothing is written, as soon as a row goes overdue. The SM stream also has to send on the minute (D-046). |
| A role's call sheet is `projectCallSheet(role, tagged, rows)`, and a sweep test checks it does not over-disclose. | `src/callsheet/callsheet.ts` (hard rule 7) | Role filtering on the channel reuses this function, and the sweep extends to stream frames (D-040). |
| The crew portal shows the **latest issued sheet**, never the live projection. | `src/callsheet/portal.ts` (D-026) | Kept. Crew see a change live when it is issued (D-041, O-3). |
| `issueCallSheets` has no event lock. Its `ponytail:` comment says a concurrent issue collides. | `callsheet.ts` | Issues become change-log writers, so they take the event lock (task L1.2). |
| The show file is an append-only `ShowFileLock` pointer. Post-lock uploads never move it. | `src/content/lock.ts` (D-016) | The channel reads the pointer when it sends. Nothing live writes it (D-042). |
| No users. `proxy.ts` puts one HTTP Basic password over every route (D-032). Portals are token-in-path. SEC-01 is open. | `proxy.ts`, `src/demo-gate.ts` | A producer stream is protected only by the demo password. A crew stream is protected by its token. The kit does not claim more (D-044). |
| Deployed on Vercel **Pro** ("the $20 Pro allocation", D-033). Push-to-deploy is off. Neon on a $20 org budget, endpoint min 0.25 CU (D-034). | `vercel.json`, decisions | The transport has to fit Pro function limits. It must not keep Neon awake when nobody is watching. |
| Not a saas-foundation clone (D-001: lifted from groundwork). | `docs/decisions.md` | Nothing template-owned is touched. See §7. |

## 2. What the card asks, as testable requirements

| # | Card phrase | Requirement | Phase-1 test |
|---|---|---|---|
| R1 | "every open run sheet and role-filtered call sheet sees a cue change as it happens with no reload" | A committed change reaches every open subscribed view within **≤ 3 s** (target ≤ 2 s at a 1 s poll), with no navigation. | Two-browser Playwright (L1.9a) |
| R2 | "two people editing the same row resolve by a recorded rule" | Reject-and-refresh on a row revision (D-039). The loser's draft is kept and both see the winner. | Concurrent-edit e2e + unit (L1.9c) |
| R3 | "a dropped connection catches up without losing or duplicating a change" | Every message is a whole projection stamped with the per-show seq. The client drops seq ≤ held. On reconnect it gets the current projection and, on producer views, the log entries it missed, each shown once. | Reconnect e2e (L1.9b) + stream unit (L1.6) |
| R4 | "role filtering and show-file locks hold on the live channel" | Each frame is built on the server for one subscriber by the existing projection functions. A token is re-checked on every poll. The show-file pointer is read when the frame is sent. | Leak sweep (L1.9d) + lock test (L1.8) |
| R5 | "Transport … chosen against what the Vercel deployment supports before any code" | O-1 recorded with a default, plus a spike on the deployed site before the stream ships (L1.0). | Spike note in NEXT.md |

## 3. What Vercel supports today (read 2026-10-19)

**Function duration (fluid compute, Node.js).** Hobby: 300 s default and maximum. Pro and
Enterprise: 300 s default, 800 s maximum, 1800 s extended maximum in beta. Max duration
"includes time spent processing the request and sending the response, including streamed
responses." Source: https://vercel.com/docs/functions/limitations (last updated 2026-08-24).
So **an SSE stream on Pro lives 300 s by default and at most 800 s (GA)**, and the client
has to reconnect.

**Streaming / SSE.** Supported from Node.js route handlers. Vercel's own realtime guide says
"browsers reconnect on their own and send a `Last-Event-ID` header that your server can
resume from". It also warns that resuming *mid-response* is the one gap.
Source: https://vercel.com/kb/guide/publish-and-subscribe-to-realtime-data-on-vercel
(updated 2026-09-10).

**WebSockets.** Public beta on **all plans** since **2026-06-22** (Python since 2026-07-23).
They need fluid compute, which is on by default for projects created on or after
2025-04-23. Connection duration is the same table as above. A connection "stays on the
function instance that accepted it". Reconnects can land on any instance, and a deploy
leaves old connections on the old deployment. **Cross-instance fan-out needs an external
pub/sub (e.g. Redis).** Next.js has no upgrade API. The docs say to use `upgradeWebSocket()`
from `@vercel/functions` ≥ 3.10.0, returned from a route's `GET`. The KB article names it
`experimental_upgradeWebSocket()`, and the two pages disagree. Billing is ordinary fluid
compute: idle connections accrue no CPU, but the instance's provisioned memory bills while
any connection is open.
Sources: https://vercel.com/docs/functions/websockets (2026-08-10);
https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections
(updated 2026-10-01); https://vercel.com/changelog/websocket-support-is-now-in-public-beta (2026-06-22).

**Price of an open connection (Pro, iad1).** Provisioned memory $0.0106 per GB-hour, Active
CPU $0.128 per hour, invocations $0.60 per million.
Source: https://vercel.com/docs/functions/usage-and-pricing (2026-06-16). One 2 GB instance
held open for an hour-long demo costs about $0.02. **A tab left open overnight costs about
$0.51 a day and keeps Neon awake**, so hidden tabs disconnect (D-043).

**Request bodies** are capped at 4.5 MB (same source as limits; already D-032's known ceiling).

**Neon and LISTEN/NOTIFY.** LISTEN needs a direct, non-pooled connection, and "scale to zero
… will terminate all listeners". Neon's guide says to turn scale-to-zero off for listening
workloads. Source: https://neon.com/guides/pub-sub-listen-notify (undated, read 2026-10-19).
That contradicts D-034's cost decision. **Live does not use LISTEN/NOTIFY.**

## 4. Hosted channels (read 2026-10-19)

| Provider | Free tier | Cheapest paid | Notes | Source |
|---|---|---|---|---|
| Ably | 6M messages/mo, 200 peak connections, 200 channels, 500 msg/s, 1-day storage | Standard $29/mo + usage | Lists ordering, history and rewind as features. Which tier gets each was not confirmed. | https://ably.com/pricing |
| Pusher Channels | Sandbox: 200k messages/day, 100 concurrent connections | Startup $49/mo (1M/day, 500 conns) | No history or replay on the pricing page | https://pusher.com/channels/pricing/ |
| Supabase Realtime | 200 peak connections, 2M messages/mo; **free projects pause after 1 week inactive** | Pro $25/mo (500 conns, 5M msgs) | A demo site visited monthly would find its channel paused | https://supabase.com/pricing |
| Liveblocks | Pricing page did not state free limits clearly. Pro $25/mo (annual) | — | Built around its own synced storage, which would be a second source of truth. A standalone broadcast was not confirmed on the page. | https://liveblocks.io/pricing |
| Cloudflare Durable Objects (PartyKit's substrate) | Free plan: 100k requests/day, 13,000 GB-s/day (SQLite backend) | Workers Paid: 1M requests/mo incl., then $0.15/M; WebSocket messages billed 20:1 | A second platform to deploy and secure. Its storage invites a second truth. | https://developers.cloudflare.com/durable-objects/platform/pricing/ (2026-10-18) |
| Upstash Redis (pub/sub for option B) | 500K commands/mo, 256 MB | $0.20 per 100K commands | The page does not say how pub/sub counts | https://upstash.com/pricing/redis |

## 5. Options against the card

All four keep Postgres as the source of truth, the per-show `changeSeq` (D-037), whole
projections at a seq (D-038), and the conflict rule (D-039). They differ in how a "something
changed" reaches an open view.

- **A. SSE from a Next route handler, polling the change seq in Postgres.** Every open view
  holds one `EventSource` to `/api/live/…`. Each second the handler reads
  `Event.changeSeq` and, if it moved, builds the subscriber's projection and sends it. It
  closes itself at about 280 s, and the browser reconnects with `Last-Event-ID`.
- **B. Vercel WebSockets (beta) plus Redis pub/sub.** A route upgrades with
  `@vercel/functions`. After commit, a server action publishes "show X at seq N" to Redis.
  Every instance subscribes and pushes to its sockets. Catch-up is still read from Postgres.
- **C. A hosted channel (Ably) that carries only a poke.** After commit, the server publishes
  `{seq}` (no content) to `show:<id>`. Each client then fetches its own projection from an
  authenticated route. Postgres serves the catch-up. Nothing filtered ever transits the vendor.
- **D. Cloudflare Durable Object per show (PartyKit-style).** One DO per show holds the
  sockets and orders messages. The app server posts to it after commit.

| Requirement | A. SSE + Postgres poll | B. Vercel WS + Redis | C. Ably, poke-only | D. Durable Object |
|---|---|---|---|---|
| Fan-out to role-filtered views | Built per subscriber in the handler, using the existing projection functions | Built per socket on the instance; Redis relays only "seq N" | Each client pulls its own projection, so the channel cannot leak | Built in the DO, which would have to call back into the app or duplicate projections. **Poor fit** |
| Ordering | `changeSeq` from Postgres; the stream sends only increasing seqs | Same, as long as clients ignore stale seqs (Redis pub/sub has no log) | Same; the vendor's ordering is not relied on | Ordered inside the DO, but that is the DO's order, not the commit order |
| Reconnect catch-up, no loss or duplication | Native: `Last-Event-ID` = seq; send the current projection if newer | Hand-built resubscribe, then fetch from Postgres | Pull from Postgres on reconnect; a lost poke is healed by the next one or by the reconnect | Hand-built, and it needs Postgres anyway to be correct |
| Conflict rule | Server actions, unchanged | Same (or over the socket, which adds a second write path) | Same | Same |
| Server-side locks and filtering | In the handler, at send time | On the instance, at send time | In the pull route; the channel holds nothing | Duplicated outside the app. **Weak** |
| Latency | Poll interval plus build time: about 1–2 s | Under 1 s | Under 1 s, plus one fetch | Under 1 s |
| Cost at demo scale (≤ 10 viewers, a few demo hours a month) | Cents in function memory. Neon awake only while a view is open (1 query per second per stream) | Same function memory, plus Redis (free tier likely) | Ably free tier (6M msgs, 200 conns) | Workers free tier likely |
| New dependencies or vendors | **None** | `@vercel/functions`, a Redis client, Upstash or Marketplace Redis | `ably` SDK plus an account and key | A second platform, wrangler, a DO class |
| Vendor lock-in | Low: plain HTTP | Medium: a beta API on one host | Low–medium: poke-only, so swapping is one module | High |
| Local and CI parity (`next start`, Playwright) | **Identical locally** | Unverified: whether the upgrade works under `next start` was not confirmed | Needs network or a fake in CI | Needs wrangler locally |
| Postgres as source of truth | Yes | Yes | Yes | At risk (DO storage) |
| Maturity on Vercel | GA (streaming) | **Beta** | GA (external) | GA (external) |

**Recommendation: A, with C as the named upgrade path.** A meets every requirement with no
new dependency or vendor. It is the only option whose e2e runs on the same `next start`
build CI and the gate already use, and filtering stays in the one place hard rule 7 already
tests. **The trade-off:** latency is a poll interval (about 1–2 s, not sub-second), and the
database takes one cheap query per second per open view. At demo scale that is nothing. At a
real show with hundreds of open call sheets it is the first thing to replace. When that day
comes, C swaps the poll for a poke without touching ordering, filtering or catch-up, because
those already live in Postgres and the projection functions. B is held back by the beta
label and by unverified local parity. D is the wrong shape for server-side filtering.
Recorded as **O-1, default A in force** (D-043).

## 6. Event-production context (why these rules)

- **A cue change during a show is a call, not an edit.** Stage managers work from the call
  sheet they were *given*. A crew member whose sheet silently changes under them is worse
  off than one who gets a re-issue they confirm. That is why crew see issued sheets live,
  not drafts (D-041). It is also why a show-day "commit and issue" is an explicit tick
  (O-3), not an automatic one.
- **Two people moving the same cue is a communication failure,** so it should surface.
  Last-writer-wins would land a cascade nobody previewed. The calling desk's rule is "one
  voice on the cue": the second caller hears "standing by, it moved" and calls again.
  Reject-and-refresh is that rule in software (D-039).
- **The GO log is where live and plan meet.** GO is an append-only write like any other, so
  it bumps the seq and reaches every SM view in other rooms. Offsets stay per room (D-010).
- **Who is looking matters as much as what changed.** Venue staff and vendors share
  networks and screens, which is why the projection is built per subscriber and why the
  sweep runs on frames, not only on PDFs.

## 7. Template (saas-foundation) implications

- Showcall is **not** a clone (D-001), so no template-owned path exists here and nothing
  in `~/Projects/saas-foundation` changes for this item.
- If A ships and holds up, `src/live/stream.ts` (the poll loop, the `Last-Event-ID` resume,
  hidden-tab close, max-life close) is a **candidate foundation module** (`realtime`) for
  the next project that needs push. Record that in saas-foundation's `BACKLOG.md` only after
  L2 has measured it. This kit does not write there.
- If O-1 moves to C, the Ably key is a new secret. It needs a name in `.env.example`
  (names only) and a Vercel env var marked Sensitive, following D-032.

## 8. Unverified (check before relying on it)

1. Whether the Vercel project has fluid compute on. It was created after 2025-04-23, so it
   should be on by default, but the Vercel API returned 404 for `showcall` in the visible
   team. L1.0 checks it in the dashboard.
2. Whether `EventSource` re-sends the cached HTTP Basic credentials behind `proxy.ts` on
   the deployed site. Same-origin should, but this is unconfirmed. L1.0 spikes it.
3. Whether Playwright's `context.setOffline(true)` drops an open `EventSource` in Chromium.
   L1.9b has a fallback: a test-only `?dropAfter=` close.
4. The exact name of the Next.js WebSocket helper (`upgradeWebSocket` vs
   `experimental_upgradeWebSocket`), and whether it runs under `next start`. This matters
   only if O-1 moves to B.
5. Ably free-tier feature gating (history, ordering). This matters only if O-1 moves to C,
   and C does not rely on either.
