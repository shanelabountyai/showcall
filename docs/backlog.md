# Backlog

One item per session. Phase gates from the PRD: no phase advances while the
prior gate's fixtures or demo story fail.

## Phase 1 — the spine

| ID | Item | Status |
|---|---|---|
| S-1 | Scaffold; agenda grid schema; conflict engine (room, turnover, speaker); publish → append-only version; public agenda view | ✅ |
| S-2 | Cue graph: run-sheet cues per room/day derived from agenda + production items, dependency anchors, cascade preview → atomic commit, slack and impossible-compression detection | ✅ |
| S-3 | Role-filtered call sheets: per-role projection, versioned issues, changed-since-last-issue diff, no-over-disclosure sweep, PDF | ✅ |
| S-4 | Stage-manager live mode: current/next cue, running offset → projected times (polling) | ✅ |
| S-5 | P0-8 basics: event/client, staffing assignments with capacity + day-of roles; agenda editing UI; seeded two-day three-track conference; GO gated to the SM (D-011) | ✅ |
| S-6 | Phase 1 gate: e2e on a production build, demo story (keynote moves 15 min → cascade → filtered re-issues) | ✅ |

## Phase 2 — the content machine

| ID | Item | Status |
|---|---|---|
| S-7 | Speaker bureau: lifecycle state machine (`invited→confirmed→contracted→content_complete→rehearsed→showed→released`), profile/AV/honorarium fields, rehearsal slots against the existing conflict engine, release/consent flags (record/distribute/publish) as structural gates with a no-path fixture | ✅ |
| S-8 | Content turn-in pipeline, part 1: tokenized submission portal for speaker decks + sponsor deliverables, versioned uploads (v1…vN kept), comment/review cycle per version, technical validation rules-as-data with a plain-language fix list | ✅ |
| S-9 | Content turn-in pipeline, part 2: approve → show-file lock (immutable), late-revision override (logged, re-validates), per-room distribution builder (checksummed manifest, running order from the agenda), stale-package flag that clears only on rebuild | ✅ |
| S-10 | Chase dashboard: turn-in deadlines derived from show date minus lead time, reminder outbox, escalation worklist, bureau missing-item flags (no headshot, unsigned, unvalidated deck) and lifecycle funnel rolled in | ✅ |
| S-11 | Phase 2 gate: e2e on a production build, demo story (a speaker submits v7 after lock → override, revalidate, distribution package rebuild) | ✅ |

Order follows the dependency chain, not the PRD's P0 numbering. Bureau (S-7)
goes first because the portal in S-8 is per-speaker and the consent flags
are bureau fields: S-7 ships them as a gate function (releasable assets
require `distributeDeck`/`publishVideo` true) with its own no-path unit
test, proven before there is anything real to gate. S-8/S-9 then build and
test validation per the build notes' TDD order (conflict engine → cascade →
**validation rules → consent no-path test**), and S-9's distribution builder
calls S-7's gate when assembling a room's package — so an unreleased
speaker's asset structurally cannot enter a manifest, closing the loop the
unit test only asserted in isolation.

See D-012 for the reasoning kept out of this table; D-017 for S-10's.

## Phase 3 — the money mechanics

| ID | Item | Status |
|---|---|---|
| S-12 | Budget spine (P0-8 rest): vendors; compliance docs (COI, W-9) with expiry and a nag worklist; budget lines per event and category — committed vs. actual, integer cents, client-billable flag; append-only budget snapshots; budget-to-actuals view | ✅ |
| S-13 | Room-block attrition (P0-5): blocks as rooms × nights × rate with dated thresholds; pickup vs. required pace, shortfall in cents at each threshold, cutoff release — all by fixture; alerts ahead of penalty dates framed as a decision ("release 10 by Friday or accept $2,400"), logged; accepted exposure posts to the budget; speaker/staff/VIP rooms draw from the block and count toward pickup | ✅ |
| S-14 | RFP normalization (P0-6): registration headcount by attendee type (the quantity basis for per-head lines); line-item schema per category as data; quotes entered as normalized lines (included / excluded / extra-cost); comparison view — totals, per-unit, inclusion matrix, gaps highlighted; award → budget commitment + contract-status record, flagged when the vendor's compliance has lapsed | ✅ |
| S-15 | Phase 3 gate: e2e on a production build, demo story (an attrition alert before D-30 → release rooms, decision logged, exposure drops; a catering RFP compared and awarded → it appears as a commitment in budget-to-actuals) | ✅ |

## Phase 4 — judgment day

| ID | Item | Status |
|---|---|---|
| S-16 | Contingency plans as data (P0-7, part 1): trigger criteria, decide-by time, owner, branches each carrying a cascade (run-sheet variant, vendor notifications, cost delta); the decide-by enters the run sheet as a cue; an unmade decision escalates at its deadline (outbox + dashboard) | ✅ |
| S-17 | Branch execution (P0-7, part 2): execute → preview → atomic commit through the existing cascade; the branch that was not taken is archived with the decision log; cost delta posts to the budget; the rain-call fixture swaps the variant and re-issues **exactly** the affected call sheets | ✅ |
| S-18 | Venue profiles (P0-8 rest): dock, power, rigging, ceiling, wifi, union house rules as structured data; load-in / load-out slots planned against them as production cues | ✅ |
| S-19 | Phase 4 gate — the capstone: e2e on a production build, the PRD's five-minute story (v7 after lock, keynote moves 15 min, rain call executes at its decide-by cue) | ✅ |

### P1, ranked — after the capstone

| ID | Item | Status |
|---|---|---|
| S-20 | P1-5 post-event reconciliation: planned vs. actual cue times from the GO log (D-010), final attrition math, budget close | ✅ |
| S-21 | P1-3 vendor/crew portal: tokenized sheet, COI upload, receipt confirmation that clears the re-issue flag | ✅ |
| S-22 | P1-1 crew work rules as data: breaks, meal-penalty and overtime warnings during run-sheet edits | ✅ |
| S-23 | P1-6 client approval gates on budget and scope changes | ⬜ |
| S-24 | P1-7 dietary and accessibility rollups for catering (counts, never names) | ⬜ |
| S-25 | P1-4 portfolio calendar with cross-event staff conflicts | ⬜ |
| S-26 | P1-2 post-show asset distribution to attendees, consent-gated | ⬜ |

Budget goes first because it is the sink: attrition exposure (S-13), RFP
awards (S-14) and contingency cost deltas (S-17) all post into it, so each
of those writes to a real ledger instead of having one added later — the
same reasoning as D-012. See D-018 for the rest, including the P1 ranking.


---

## Security findings — saas-foundation audit (2026-09-23)

Source: `~/Projects/saas foundation/audit/showcall.md` (full scorecard K1–K14 and evidence). Read-only audit; line numbers are as of 2026-09-23 — **re-verify before fixing**. IDs are `SEC-nn` / `OPS-nn` so they cannot collide with this repo's numbering; convert to a native item when picked up.

### Gaps

| ID | Sev | Finding + exploit | Fix | Acceptance test |
|---|---|---|---|---|
| SEC-01 | HIGH (blocks any deploy) | **No authentication anywhere.** Every page and `'use server'` action is unguarded (K3 evidence). Exploit on any reachable URL: anyone can read budgets, contracts and speaker honoraria (`speakers/page.tsx:55`), download every uploaded deck (`content/file/[versionId]/route.ts`), create events, award RFPs, override content locks and record GO marks as any stage manager (`live/page.tsx:30` takes `staffId` from the form). Server actions are POST endpoints that can be called directly, so hiding the UI does not protect them. | Before any deploy: add auth, for example the saas-foundation session kit with a `requireStaff()` guard at the top of every action and page plus the file route. Keep `/portal/[token]` public. At minimum until then, Vercel deployment protection or basic auth over the whole app. | e2e: an unauthenticated GET `/events/<id>/budget` redirects to sign-in, and a direct server-action POST without a session is refused. A test enumerates every `'use server'` export and asserts that it calls the guard. |
| SEC-02 | MED | **Cross-event writes by secondary id.** The K4 list: for example, `approve(versionId)` (`src/content/lock.ts:29`) is called from `/events/A/content` with a `versionId` from event B, and `updateLine(lineId)` (`src/budget/budget.ts:37`) does the same. Exploit (after auth or tenancy): a user of event A edits or locks event B's records by changing the hidden form field. | Pass `eventId` into each function and scope the lookup (`where: { id, deliverable: { eventId } }`), following `grid.ts:36,44`. Treat not-found and not-yours alike. | Unit test per function: calling with another event's id throws not-found and writes nothing. `grid.test.ts:56` is the model. |
| SEC-03 | MED | **Anyone can reissue a speaker's or sponsor's portal link.** `doLink` (`content/page.tsx:59-67`) is unguarded and `issuePortalToken` overwrites the hash. Exploit: an attacker mints a new link for any speaker. That revokes the real speaker's link (DoS) and lets the attacker upload content that enters the lock and distribution pipeline under the speaker's name. | This is covered by SEC-01. Also log reissues against the actor. | Test: `doLink` without a staff session is refused, and a reissue writes an audit row. |
| SEC-04 | ✅ FIXED S-21 (D-026) | **Portal token in a query string.** `content/page.tsx:66` puts `?link=<raw token>` in the URL, which ends up in browser history, proxy/access logs and screenshots. | Show the token once in the rendered response (a server action returning state) or via a flash cookie. Never put it in the URL. | Test: after `doLink`, the response URL contains no `link=` parameter. |
| SEC-05 | ✅ FIXED S-21 (D-026) | **The portal has no expiry and no protective headers.** `app/portal/[token]/page.tsx` sets no `Cache-Control: no-store`, `Referrer-Policy: no-referrer` or `robots: noindex`, and the token has no expiry column (`schema.prisma:106-107`). A leaked link works until someone reissues it. | Add `portalTokenExpiresAt`, check it in `resolvePortal` and `ownerOf`. Add `metadata.robots` and headers for `/portal/*` in `next.config.ts`. | Test: an expired token returns 404, and the portal response has all three headers. |
| SEC-06 | LOW | **No global security headers** (`next.config.ts`). Pages can be framed, and there is no HSTS or Referrer-Policy. | Add `headers()` with HSTS, `X-Frame-Options: DENY`/`frame-ancestors 'none'`, `Referrer-Policy`, nosniff. | Test: a production-build response for `/` carries the headers. |
| SEC-07 | LOW | **Unthrottled public upload.** The portal accepts 25 MB uploads per request with no rate limit, and bytes are stored in Postgres (`pipeline.ts:91`). Exploit: someone with a leaked portal link can fill the DB. | Rate-limit per token in a shared store, and cap the number of versions per deliverable. | Test: the N+1th upload within the window is refused. |
| SEC-08 | LOW | **Uploaded MIME type is echoed from the client.** `pipeline.ts:91` stores `file.type`, and the download returns it as `Content-Type`. This is mitigated by `attachment` plus `nosniff` (`route.ts:10-12`). | Allowlist MIME types (pdf, pptx, keynote, images, video) and default to `application/octet-stream`. | Test: an `text/html` upload is served as `application/octet-stream`. |

### Ops items

| ID | Item |
|---|---|
| OPS-01 | Do not connect the repo to Vercel, not even for previews, until SEC-01 lands. With git integration, every push creates a public preview URL, and in this app that means unauthenticated write access. |
| OPS-02 | Add `SHOWCALL_ALLOW_CLOUD_DB` to `.env.example` as a name with a comment. |
| OPS-03 | Confirm in the Vercel dashboard that no `showcall` project exists, since the API listing returned none (UNVERIFIED). |
