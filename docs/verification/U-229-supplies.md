# U-229 — Isolated replacement finite-cache proof

The production `qalat-road` registry, event script, lobby and saves are unchanged. U-233 owns activation. Owner U-234 feedback remains deferred without a fabricated test verdict; U-119 remains final acceptance.

## Authored and bound data

- `qalat-replacement-supplies.json` declares the five §12 finite caches using the existing schema: **24 rockets**, **21 primary-magazine equivalents**, **8 health-kit charges**; no firearm pickup IDs or random drops.
- Source-bound `supplyCaches` and `supplyDigest` are serialized by `buildReplacementBundle`. Reload checks the transported digest before building the world, then validates against the originally authored immutable source. Existing U-227 manifest hashes and U-228 encounter sidecar remain intact.
- `P-BASEMENT` is one metre east of the literal §12 coordinate due to an already accepted solid B7 bench occupying (-22,0,314). The bench, room and map are unchanged. Record this deviation for future human visual review.

## Test and CI gates

- `pnpm exec vitest run packages/tools/src/maps/qalatReplacementSupplies.test.ts packages/tools/src/maps/qalatReplacement.test.ts`: fixed IDs/stocks, exact floor geometry, real isolated Session capacity/stock and timed use, serialized source tamper refusal, and standing-nav/path connectivity.
- `pnpm gen:qalat-replacement`, `pnpm gen:qalat-replacement --check`, `pnpm check:assets`, `pnpm check:packs`, `pnpm verify`, affected streaming capture; four latest-head CI jobs `verify`, `streaming`, `parity-non-v8`, `mission` must succeed before merge.
- Current PR: https://github.com/JoshuaLRay/Sandline/pull/377 . The prior WIP CI on `5531400` passed all four jobs **before** the merge/integration; it is not final delivery evidence. Consult CI for latest head and log actual evidence, failures and any corrective follow-up here before marking DONE.
- Existing U-112/U-133/U-145/U-148 transfers, chooser UI, concurrent stock serialization, cancel, reconnect and save rules are reused, not reimplemented. Full replacement checkpoint lifecycle remains U-232.
