# U-235 — CI wall-time performance evidence

## Baseline (observed on unmodified workflow)

- Successful [#39099861824](https://github.com/JoshuaLRay/Sandline/actions/runs/39099861824), head from U-229 before source-verified bundle integration: all four checks success.
  - `pnpm verify` Vitest summary: 657.20s (10m57s); test run is part of a longer `verify` job.
  - `streaming`: client build ~78s, load checks 22s +25s, isolated preview ~81s, map capture ~133s, road supports ~286s, replacement ~198s. Captures were sequential.
- [#39116466103](https://github.com/JoshuaLRay/Sandline/actions/runs/39116466103), U-229 head `8ad382e78e671cb2193c4bfa812fb945ab17f63b`: streaming / parity-non-v8 / mission success, verify failure. Vitest summary 1200.75s (20m01s); 1 failed / 3765 passed.
  - Failing test: `packages/tools/src/maps/qalatReplacement.test.ts:81`, P-ROAD nav connectivity false. This is **U-229** work, not a reason to weaken CI.
  - Slow individual files (same run): qalatDepotTraversal 308.48s, qalatReplacement 214.77s, qalatRoadSupports 183.47s, assets 128.97s, qalatOutpostSession 120.02s.
  - Streaming stage wall times: build ~89s, map review ~132s, road supports ~288s, replacement ~230s.
- Before these optimizations, the typical complete workflow was limited by the slower sequential streaming and unsharded Vitest run; no guaranteed sub-10-minute baseline.

## New design and invariants

- Vitest splits the **entire** discovered file set into four official `--shard=i/4` partitions; `pnpm verify` retains typecheck, lint and one mandatory test partition, while three other partitions run `pnpm test`. Local `pnpm verify` (without CI shard variable) remains the full suite.
- `verify` is a stable fail-closed aggregation of verify-core and verify-extra matrix. Missed, skipped, cancelled or red partitions cannot pass.
- `streaming-core` and five `streaming-captures` members run concurrently. Each capture generates its own level/bundle, uses Playwright Chromium, enforces budgets and uploads the same named evidence artifacts. The stable `streaming` gate fails unless every participant succeeds.
- `parity-non-v8`, `mission`, and `deploy-worker.needs` are unchanged. Main-only, latest-main and secret/config deploy protections remain intact. Existing timeouts unchanged for substantive workers.

## After timings (required before merge)

PR: pending. Final latest-head SHA: pending. Latest run URL: pending.
- `verify`: pending actual all-shard gate time (not a measured success).
- `streaming`: pending actual all-capture gate time (not a measured success).
- `parity-non-v8` / `mission`: pending.
- Full PR CI elapsed time: **unmeasured**. Under-10m goal **unverified**; initial under-15m goal **unverified**.
- Evidence requirements: record run URLs, start/completion times, all artifact uploads, 376+ test files coverage (expected may change with new tests), and all four latest-head success states. If a performance target misses, document instead of claiming achievement.
