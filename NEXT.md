# Next

**S-4 — stage-manager live mode** (`docs/backlog.md`). Current/next cue and a
running late/early offset propagating to projected times, via polling. Reads
`loadRunSheet` (`src/runsheet/cascade.ts`); "now" comes from the injected
clock (`src/clock.ts`). Decide first where the running offset lives. It is
live state, not a cue edit, so it must never write through the cascade.
