# Next

**Phase 2 is scoped** (S-7…S-11 in `docs/backlog.md`), sequenced bureau-first
against the PRD's own P0-3/P0-4 numbering — reasoning in D-012.

**Next: S-7 — speaker bureau.** Lifecycle state machine
(`invited→confirmed→contracted→content_complete→rehearsed→showed→released`),
profile/AV/honorarium fields on `Speaker`, rehearsal slots reusing the
existing conflict engine, and release/consent flags exposed as a gate
function with its own no-path unit test (nothing to gate yet — S-9's
distribution builder calls it later). Model: Opus plans, Sonnet builds
(D-005's split), same as every prior item.
