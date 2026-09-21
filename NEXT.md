# Next

**S-6 — Phase 1 gate** (`docs/backlog.md`): e2e on a production build
(Playwright, `webServer` on :4000 against `.env.test`, build + serve in one
script), and the demo story on the seeded summit — keynote moves 15 min →
cascade preview/commit → only the affected call sheets re-issue. The seed
(`npm run db:seed`) makes day 1 today, so live mode is mid-show; GO needs
`?as=<stage manager>` (D-011). The UI paths (grid edit/publish, staffing
refusals, gated GO) have unit coverage only so far; S-6's e2e is their first
browser test.
