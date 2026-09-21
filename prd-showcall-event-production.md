# PRD: Showcall — Corporate Event Production Operations

**Sample business:** "Showcall Productions," a production company running corporate conferences, galas, and multi-track summits (200–2,000 attendees)
**Status:** Draft v1.0 — written with PM review AND a senior-event-producer deep review baked in (tags: *producer review*)
**Scope stance:** the largest B2B project in the library (six net-new artifacts) and the designated **event-tools feeder** — every P0 is a professional planner's real tool. Built in shippable phases.
**Learning objectives:** minute-level dependency scheduling with role-filtered distribution, versioned content turn-in pipelines with technical validation, speaker lifecycle management with consent gating, contractual attrition tracking, quote normalization, contingency decision trees

---

## Problem Statement

A corporate show is a thousand deadlines wearing a lanyard: speakers who submit decks at 11pm the night before, hotel blocks with penalty clauses, a run-of-show timed to the minute where the florist must not see the CEO's talking points, and a rain plan someone has to call by 10am. Production companies run this on spreadsheets, email chains, and heroics. The builder lessons: **micro-scheduling with derived call times**, **controlled document pipelines**, and **contract-mechanic tracking** — the operational spine of the events industry, and direct reconnaissance for the event-tools product line.

## Goals

1. The agenda is the source of truth: sessions/rooms/times conflict-checked, with the run sheet and every call sheet derived from it.
2. Speaker and sponsor content flows through one turn-in pipeline — versioned, technically validated, locked into show files, and distributed to playback in running order.
3. Speakers are managed as a lifecycle: from confirmation through rehearsal to post-show release consent.
4. Room-block attrition and other contract mechanics are tracked against penalty deadlines before they cost money.
5. Contingencies are decisions with deadlines, not vibes.
6. **(Builder goal)** The six artifacts above, plus deep reuse (staffing, budgets, registration, vendor compliance) proving the library.

## Non-Goals

- Attendee-facing event apps / networking features (this is the production back-office)
- Ticket sales (Marquee's lesson; registration here is headcount + attendee-type tracking)
- AV hardware control / playback software itself (the pipeline *feeds* playback; it doesn't run video)
- Real travel booking (itineraries tracked, not booked), real e-signature (status tracking; seam noted)
- Speaker sourcing marketplace (Tradepost-shaped; the bureau manages *booked* speakers)

## Personas

Producer (owns the show) · Production coordinator · Stage manager (day-of, run sheet consumer) · Speaker (tokenized portal: profile, deck turn-in, rehearsal) · Sponsor contact (tokenized: deliverables) · Vendor/crew (call-sheet recipients) · Client (approval gates, read-only dashboards).

## Requirements — Must-Have (P0)

**P0-1: Agenda grid** *(supporting spine — producer review #4)*
Multi-track session model: sessions × rooms × time slots with speakers attached; conflict detection (room double-booked, speaker in two places, insufficient turnover time between sessions per room).
- [ ] Turnover rules per room as data (strike/reset minutes); violations block publish with the conflict named
- [ ] Published agenda view (public-safe) renders from the grid; changes version (append-only house pattern) and flag downstream artifacts stale (run sheet, call sheets, show files)

**P0-2: Run sheet + role-filtered call sheets** *(core artifact #1)*
Minute-level run-of-show per room/day derived from the agenda plus production items (doors, walk-ins, strikes): each cue carries dependencies so times derive ("photos end 4:40 because ceremony 5:00 because sunset 7:12" — anchor math shared with Knotwork's scheduler, minute granularity).
- [ ] A time change cascades through dependent cues with preview → atomic commit (house cascade pattern); slack and impossible-compression detected
- [ ] **Call sheets generate per role** (producer review: the florist never sees the toast order): each vendor/crew/speaker gets exactly their cues + call times + location/dock info — filtered views as regenerable artifacts (PDF, house tooling), versioned, re-issued on change with a changed-since-last-issue diff
- [ ] Stage-manager live mode: current/next cue, running late/early offset propagating to projected times (polling)

**P0-3: Content turn-in pipeline** *(core artifact #2 — producer review #2/#3)*
One engine, two chase lists: **speaker decks** and **sponsor deliverables** (logos, banners, booth info).
- [ ] Tokenized submission portal per speaker/session and per sponsor; versioned uploads (v1…vN preserved), comments/review cycle per version
- [ ] **Technical validation pass, rules as data** (Adjuster's pattern): aspect ratio, fonts embedded, file size, video codec allowlist, brand-template compliance — failures return a plain-language fix list; validation rules per event
- [ ] Approve → **show-file lock**: locked files are immutable; late revisions (the 11pm v7) require an override with reason, logged, and re-trigger validation + distribution *(producer review: the cutoff-with-override rule, exactly)*
- [ ] **Distribution builder**: per-room playback packages assembled in running order from the agenda, manifest checksummed; regenerated automatically when the agenda or a locked file changes, with the stale-package flag until rebuilt
- [ ] Chase dashboard: turn-in status by deadline (derived from show date minus validation/rehearsal lead — anchor math again), reminder cadence (outbox), escalation worklist

**P0-4: Speaker bureau** *(core artifact #3 — producer review #1)*
Speaker lifecycle: `invited → confirmed → contracted → content_complete → rehearsed → showed → released`; profiles (bio, headshot via the upload pipeline), session assignments (agenda-linked), AV needs per speaker, honorarium/contract status (integer cents; e-sign status seam), travel + hotel needs feeding P0-5's block.
- [ ] **Release/consent tracking**: per-speaker consent flags (record session? distribute deck? publish video?) gate post-show distribution structurally — no consent, no asset leaves (Quorum's structural-gate discipline)
- [ ] Rehearsal slots schedule against the agenda grid (same conflict engine — reuse proof)
- [ ] Bureau dashboard: lifecycle funnel, missing-item flags (no headshot, unsigned, deck unvalidated) rolled into the chase dashboard

**P0-5: Room-block attrition** *(core artifact #4)*
Negotiated hotel blocks: rooms × nights × rate, **contractual attrition thresholds with dates** (fill 80% by D-30 or pay the shortfall); pickup tracked against the burn-down.
- [ ] Burn-down math fixtures: pickup pace vs. required pace, projected shortfall in dollars at each threshold date (integer cents), cutoff-date release mechanics
- [ ] Alerts fire ahead of penalty dates with the decision framed ("release 10 rooms by Friday or accept $2,400 exposure") — decisions logged *(producer review: this is where shows lose real money quietly)*
- [ ] Speaker/staff/VIP room assignments draw from the block and count toward pickup

**P0-6: RFP normalization** *(core artifact #5)*
Structured quote requests to vendors (line-item schema per category: catering, AV, decor); responses entered/imported into comparable normalized line items — what "all-inclusive" actually includes, apples to apples.
- [ ] Comparison view: normalized totals, per-unit costs, inclusion matrix (included/excluded/extra-cost per line) with gaps highlighted
- [ ] Award flow: selected quote converts to a vendor budget commitment (feeds P0-8) and a contract-status record

**P0-7: Contingency decision trees** *(core artifact #6)*
Plans as data: trigger criteria, **decide-by time** ("call it 10am day-of"), decision owner, and the cascade each branch implies (run-sheet variant, vendor notifications, cost deltas).
- [ ] Decide-by times enter the run sheet as cues; unmade decisions escalate at deadline (outbox + dashboard)
- [ ] Executing a branch applies its cascade with preview → atomic commit; the not-taken branch archives with the decision log
- [ ] Fixture: a rain call at deadline swaps the run-sheet variant and re-issues exactly the affected call sheets

**P0-8: Supporting spine** *(reuse)*
Event/client model with backward milestone timeline (shared scheduler core) · staffing assignments with capacity + day-of roles (Groundwork's crew model) · registration headcount by attendee type against capacity tiers · budget-to-actuals per event with client-billable flags (integer cents, snapshots) · **vendor compliance docs** (COI, W-9) with expiry tracking and nag worklist · **venue profiles as structured data** (dock, power, rigging, ceiling, wifi, union house rules — *producer review #5*) feeding load-in/load-out slot planning.

## Nice-to-Have (P1)

- **P1-1:** Crew work rules (union-style: breaks, meal-penalty and overtime triggers) as rules-as-data, warning during run-sheet edits *(producer review #6)*
- **P1-2:** Post-show asset distribution — recordings/decks to attendees, gated per-speaker consent from P0-4 *(producer review #7)*
- **P1-3:** Vendor/crew portal (tokenized: my call sheet, upload COI, confirm receipt — receipt confirmations clear P0-2's re-issue flags)
- **P1-4:** Multi-event portfolio calendar with **staff-conflict detection across events** (flagged honestly: the hardest P1 here — cross-event constraint checking)
- **P1-5:** Post-event reconciliation — planned vs. actual cue times from stage-manager mode (where the show slipped), attrition final math, budget close
- **P1-6:** Client approval gates on budget/scope changes (Knotwork's dual-consent, B2B)
- **P1-7:** Dietary/accessibility rollups for catering (counts, never names — shared module with Knotwork)

## Future Considerations (P2)

Equipment/asset inventory · profitability by event type · real e-signature + travel integrations (productionize pass) · playback-system export formats as adapters.

## Success Metrics (seeded)

- Agenda conflicts: 100% of fixture violations caught and named; publish blocked correctly
- Run sheet: cascade fixtures (incl. impossible-compression), call-sheet filtering verified per role against a scripted show (no over-disclosure — asserted by sweep), re-issue diffs exact
- Pipeline: validation rules fixtures; lock immutability at API level; late-override path logged; distribution manifests checksum-stable and rebuilt on every upstream change (staleness fixture)
- Bureau: lifecycle transitions valid; consent gates structurally block unreleased assets (the Quorum-style no-path test)
- Attrition: burn-down and shortfall math to the cent across threshold fixtures
- Contingency: the rain-call fixture swaps variants and re-issues exactly the affected sheets
- Capstone demo: one two-day, three-track seeded conference — a speaker submits v7 after lock (override, revalidate, package rebuild), the keynote moves 15 minutes (cascade, filtered re-issues), the rain call executes at its decide-by cue — the whole nervous system in five minutes

## Phasing — each gate ships

- **Phase 1 (the spine):** P0-1 agenda + P0-2 run sheet/call sheets + P0-8 event/client/staffing basics
- **Phase 2 (the content machine):** P0-3 pipeline + P0-4 bureau
- **Phase 3 (the money mechanics):** P0-5 attrition + P0-6 RFP + budget spine
- **Phase 4 (judgment day):** P0-7 contingency + P1 in ranked order
Rule: no phase advances while the prior gate's fixtures or demo story fail.

## Build Notes for Claude Code

CLAUDE.md: house conventions + **the agenda is the single source; derived artifacts flag stale, never silently drift**, **locked show files are immutable; overrides are logged events**, **consent gates are structural (no code path distributes unreleased assets)**, **call-sheet filtering is tested by sweep, not trust**. TDD order: agenda conflict engine → cue cascade → validation rules → consent no-path test. WRITEUP.md angle: this repo is the event-tools research artifact — every producer-review feature that survives contact with the build becomes a validated requirement for the product line; log those verdicts as you go.
