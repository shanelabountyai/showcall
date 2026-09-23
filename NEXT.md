# Next

**Scope Phase 3 into items.** Phase 2's gate (S-11) passed, so per
`docs/backlog.md` Phase 3–4 now gets broken into items: attrition + RFP +
budget (P0-5, P0-6), then contingency + P1s (P0-7). Same shape as commit
f00a6a1 (Phase 2 scoping): the items in dependency order, with the reasoning
logged as a decision. Recommend Opus. It is architecture work, and the
order sets up everything after it.

State after S-11:
- Gate is green: 124 unit tests, 14 e2e on a production build.
- Seed change: Hollis Grant's deck is now v1–v6 with v6 locked, so the demo's
  late upload is v7. Re-seed dev (`npm run db:seed`) before demoing.
- The gate story is browser-only (e2e spec "Phase 2 gate (S-11)"). No
  script needed; `scripts/demo.ts` still covers the Phase 1 backend half.
