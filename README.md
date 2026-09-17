# SANDLINE

Browser-based 6-player co-op squad shooter. See [`PLAN.md`](./PLAN.md) for the
full plan and task backlog, and [`docs/adr/`](./docs/adr/) for locked decisions.

## Quick start

```bash
pnpm install
pnpm verify                 # typecheck + lint + test — the gate every task must pass
pnpm --filter @sandline/client dev    # renderer at localhost:5173
pnpm exec tsx packages/server/src/main.ts   # headless authoritative server
```

## Useful commands

| Command | What it does |
|---|---|
| `pnpm verify` | typecheck + lint + test |
| `pnpm sim-run --scenario crowd --ticks 1800` | headless simulation, reports µs/tick |
| `pnpm sim-run --scenario fall --ticks 1000 --parity` | two instances, reports divergence |
| `pnpm bench:rapier` | deterministic vs default vs SIMD physics cost |
| `pnpm gen:trig` | regenerate the committed trig table |
| `pnpm test:parity-browsers` | parity on Firefox + WebKit (needs `playwright install firefox webkit`) |

## Two things that will bite you

**Never call `Math.sin`/`cos`/`atan2`/`random` in `packages/shared`.** They are
not cross-engine deterministic. Lint blocks them. Use `shared/src/math`. The
server is Node (V8) and Chrome is V8, so violations are invisible in development
and only break Safari and Firefox players — see [ADR-014](./docs/adr/014-determinism-policy.md).

**Parity is bounded, not bit-exact.** Assert divergence under a threshold and log
the number. Exact equality is correct only on integer paths (tick counts, wire
round-trips, table lookups). Same ADR.
