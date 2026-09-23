# Showcall — demo script

Synthetic data only. Port 4000. No logins: the app has no auth (roles are per-link and per-room).

## Setup (once)

```bash
npm run db:migrate:test && npm run db:seed:test   # local Postgres, showcall_test
npm run e2e:server                                # production build, served on :4000
```

Open http://localhost:4000. Two events are seeded: **Northwind Leadership Summit** (agenda, live mode, content) and **Northwind Fall Sales Kickoff** (rooms, RFPs, budget).

## Phase 3 story — "the money decisions" (Kickoff event, ~4 min)

| Stop | Click | Say |
|---|---|---|
| 1. Attrition alert | Northwind Fall Sales Kickoff → **Rooms** | "The hotel block is 19 room-nights short of the 80% threshold. The alert is framed as a decision: release 24 room-nights by the date, or accept $4,541.00." |
| 2. Release | **Release 24** | "Releasing costs nothing, so the alert clears and the decision is logged. Had we accepted, the shortfall would post to the budget as a line." |
| 3. RFP comparison | **RFPs** | "260 registered. Harvest is cheapest but excludes the afternoon break, so it isn't comparable. Summit at $22,060.00 is the lowest *complete* quote." |
| 4. Award | **Award Summit Hospitality Group $22,060.00** | "The award records rather than refuses. Its COI lapses on day 1, so the contract carries the compliance flag." |
| 5. Ledger | **Budget** | "The award is a commitment in budget-to-actuals, still flagged 'compliance outstanding'. No attrition line: releasing rooms cost nothing." |

## Phase 4 preview — "the calls nobody made" (Summit event, ~1 min)

S-17 adds execution. For now the story is the plan and its deadline.

| Stop | Click | Say |
|---|---|---|
| 1. Overdue call | Northwind Leadership Summit → **Chase** | "Above the worklist: a contingency call is past its decide-by. The doors-hold decision was due at 8:25 and nobody made it." (Only after 8:25 Chicago time; before that, it's still open.) |
| 2. The plans | **Contingency** | "The rain call is due at 10:00 tomorrow, seven hours before the reception, and anchored to it. Move the reception and the deadline moves too. Each branch says what it would change, who gets told, and what it costs." |
| 3. Escalation | Scroll to **Escalation outbox** | "The unmade doors call went out once, to its owner and the producer. The deadline is the key, so it can't go out twice." |

## Troubleshooting

| Symptom | Fix |
|---|---|
| Home page has no events | Seed didn't run: `npm run db:seed:test` |
| Attrition alert already cleared, no Release button | The e2e sweep (or an earlier run) already released: re-seed |
| Award button missing | Already awarded: re-seed |
| Port 4000 busy | `lsof -ti :4000 \| xargs kill` |

## Concede before you're asked

- Synthetic data; no auth; nothing deployed.
- Releasing rooms posts nothing to the budget by design (D-018): only accepted exposure and awards do.
- Attrition thresholds net against each other, so the block is never charged twice for the same room-night.
