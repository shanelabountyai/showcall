# Showcall — demo script

Synthetic data only. Port 4000. No user logins: roles are per-link and per-room. The live copy at https://showcall.labintelligence.co sits behind one shared HTTP Basic password (any username; the password is in the gitignored `.env.deploy.local`, `grep '^' .env.deploy.local | cut -d= -f1` shows the variable name). Uploads over 4.5 MB fail there.

## Setup (once)

```bash
npm run db:migrate:test && npm run db:seed:test   # local Postgres, showcall_test
npm run e2e:server                                # production build, served on :4000
```

The seed prints four one-time portal links (Hollis Grant's content link, Avery Chen's recap, A1 Audio's crew link, the client budget link). Copy them, or reissue in the app; on the live site they were not kept, so reissue: content page, call sheets, budget, packages → Attendee recap links.

Open http://localhost:4000. Three events are seeded (the third, Northwind West Roadshow, exists for the calendar stop). The two main ones: **Northwind Leadership Summit** (agenda, live mode, content) and **Northwind Fall Sales Kickoff** (rooms, RFPs, budget).

## Phase 3 story — "the money decisions" (Kickoff event, ~4 min)

| Stop | Click | Say |
|---|---|---|
| 1. Attrition alert | Northwind Fall Sales Kickoff → **Rooms** | "The hotel block is 19 room-nights short of the 80% threshold. The alert is framed as a decision: release 24 room-nights by the date, or accept $4,541.00." |
| 2. Release | **Release 24** | "Releasing costs nothing, so the alert clears and the decision is logged. Had we accepted, the shortfall would post to the budget as a line." |
| 3. RFP comparison | **RFPs** | "260 registered. Harvest is cheapest but excludes the afternoon break, so it isn't comparable. Summit at $22,060.00 is the lowest *complete* quote." |
| 4. Award | **Award Summit Hospitality Group $22,060.00** | "The award records rather than refuses. Its COI lapses on day 1, so the contract carries the compliance flag." |
| 5. Ledger | **Budget** | "The award is a commitment in budget-to-actuals, still flagged 'compliance outstanding'. No attrition line: releasing rooms cost nothing." |

## Phase 4 preview — "the calls nobody made" (Summit event, ~2 min)


| Stop | Click | Say |
|---|---|---|
| 1. Overdue call | Northwind Leadership Summit → **Chase** | "Above the worklist: a contingency call is past its decide-by. The doors-hold decision was due at 8:25 and nobody made it." (Only after 8:25 Chicago time; before that, it's still open.) |
| 2. The plans | **Contingency** | "The rain call is due at 10:00 tomorrow, seven hours before the reception, and anchored to it. Move the reception and the deadline moves too. Each branch says what it would change, who gets told, and what it costs." |
| 3. Escalation | Scroll to **Escalation outbox** | "The unmade doors call went out once, to its owner and the producer. The deadline is the key, so it can't go out twice." |
| 4. Make the rain call | Rain call → **Preview Rain: move to Ballroom A** | "Before anything changes, it shows what will: the reception moves from the terrace at 17:00 to Ballroom A at 17:30, and two call sheets change, Catering and Doors & Registration. A1 Audio isn't on the list." |
| 5. Execute | **Execute Rain: move to Ballroom A** | "One commit covers the run sheet, the $3,800 on production and the decision. Only those two call sheets re-issued. The dry branch stays on file, marked not taken." Point at the **Decision log**. |

## Phase 4 capstone — "five minutes, the whole nervous system" (Summit event, ~5 min)

Start from a fresh seed (`npm run db:seed:test`). The e2e sweep runs this story itself, so it leaves the event spent.

| Stop | Click | Say |
|---|---|---|
| 1. The 11pm v7 | Northwind Leadership Summit → **Content** → Hollis Grant → **Reissue portal link** → **open**, upload a PDF | "v6 is locked as the show file. A late v7 is kept but changes nothing. The lock holds." |
| 2. Override | Back to **Content**, v7 → reason "Speaker revised Q3 figures at 11pm" → **Override lock to this version** | "An override is logged with its reason and re-validated against today's rules. v1 would be refused." |
| 3. Rebuild | **Packages** → Ballroom A → **Rebuild package** | "The package went stale and named what changed. Distribution happens only on a producer's rebuild." |
| 4. Keynote moves 15 | **Draft grid** → keynote 09:15–10:15 → **Save** → **Publish version 2** | "The grid publishes only while it's clean. v1 stays on file, append-only." |
| 5. Rebase | **Live** → **Rebase and re-issue call sheets** | "The run sheet was stale against v2. The rebase re-issues A1 Audio and Doors & Registration, the only sheets the keynote touches. Catering isn't on the list." |
| 6. Rain call | **Contingency** → **Preview Rain: move to Ballroom A** → **Execute** | "Still open before its 10:00 decide-by, never escalated. One commit moves the reception to 17:30 in Ballroom A, the load-out follows it, $3,800 posts, and only Catering and Doors & Registration re-issue." |

## Phase 5 — "the people outside the building" (~6 min)

Start from a fresh seed. Portal links are the seed's printed ones, or reissued in the app.

| Stop | Click | Say |
|---|---|---|
| 1. Overtime is a warning | Summit → **Contingency** → **Preview Rain: move to Ballroom A** → the **Work rules** list | "The later reception runs the door crew past the ten-hour straight-time day. The preview says by how many minutes, and warns rather than blocks: a producer can still make the call." |
| 2. Crew portal | Open the A1 Audio crew link (`/portal/call/…`) | "A1 Audio sees only its own cues: walk-in music, mic swaps. Lunch service, Catering's cue, isn't there. **Confirm I have issue 1** and the producer's call sheets page flips to *receipt confirmed*. The link is a secret, and the page is no-store and noindex." |
| 3. Client approval | Summit → **Budget** → **Client approval** | "The client approved snapshot 1 at $130,240.00. The LED change order is $18,000.00 to $19,850.00: $1,850.00 unapproved, and it blocks the close." Take a snapshot ticked *send to the client*, open its client link (`/portal/client/…`): the client sees their lines only, no crew meals, and a decline needs a reason. |
| 4. Catering rollup | Kickoff → **RFPs** | "The caterer gets counts, never names: vegetarian 26, from 238 attendee records of 260 registered. 22 registered have no record, and the page says their needs are unknown rather than guessing." |
| 5. Portfolio calendar | Home → **Portfolio calendar** | "Sam Okafor closes the Kickoff at 23:00 Chicago and opens the West Roadshow at 6:00 Los Angeles: 9 hours of rest, 10 owed. Shifts are compared as instants, so the timezone gap can't hide it." |
| 6. Recap | Summit → **Packages** → **Attendees** | "Lucia Varga's recording is withheld, and it says why: she did not consent to recording. Owen Castellano's is released." |
| 7. Attendee link | **Attendee recap links** → Avery Chen → **Reissue**, open it | "Avery's page lists session decks, plus Owen's recording. Lucia's deck is there, her recording isn't. Consent is checked again on every download, so a withdrawal takes effect before any rebuild." |

## Troubleshooting

| Symptom | Fix |
|---|---|
| Home page has no events | Seed didn't run: `npm run db:seed:test` |
| Attrition alert already cleared, no Release button | The e2e sweep (or an earlier run) already released: re-seed |
| Award button missing | Already awarded: re-seed |
| Rain call shows decided, no Preview links | Already executed (the e2e sweep executes it): re-seed |
| Portal link 404s | Links are shown once and a reseed invalidates them: reissue from the app (see Setup) |
| Rain-call work-rule warning is missing | The rain call was already executed: re-seed |
| Live site returns 401 | Basic auth: any username, the password from `.env.deploy.local` |
| Port 4000 busy | `lsof -ti :4000 \| xargs kill` |

## Concede before you're asked

- Synthetic data; no user accounts (per-link roles, one shared password on the live site); the live copy holds the demo on purpose.
- The rain call is executed before its decide-by, not watched ticking over: the app reads the real clock, and the cue is tomorrow at 10:00. Unit tests cover the deadline escalation on an injected clock.
- Releasing rooms posts nothing to the budget by design (D-018): only accepted exposure and awards do.
- Attrition thresholds net against each other, so the block is never charged twice for the same room-night.
