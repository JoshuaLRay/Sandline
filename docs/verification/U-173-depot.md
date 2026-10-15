# U-173 — Integrated furnished depot engineering evidence

The isolated D0↔B0–B10 construction retains the approved U-172 geometry.
Campaign activation remains U-117; human whole-mission acceptance remains U-119.
These movement/occlusion fixtures are engineering evidence, not a combat playtest.

## Seven real Session actors

An ordinary loopback commander sets every soldier's Tight/Standard/Wide preset,
spectates, sends Move orders, then sends Hold after all seven enter B3/B5/B6/B7.
B5 uses its independently specified 8×8 clear pocket. The final destination is
inside the far half of B10's porch so trailing Wide destinations reach the landing.
No mid-run position reset, synthetic link, vault, floor snap or unlisted exit occurs.

Every actor independently crosses all 35 specified route regions, all 20 doorway
planes and every stair/rest, in order, then settles at y8. Per-tick checks retain
standing clearance, intended support, health, route confinement and body separation.

| Direction | Spread | Simulation ticks | Simulation seconds | Regions / doors per actor |
|---|---|---:|---:|---:|
| D0→B10 | Tight | 3600 | 120.00 | 35 / 20 |
| D0→B10 | Standard | 3599 | 119.97 | 35 / 20 |
| D0→B10 | Wide | 3609 | 120.30 | 35 / 20 |
| B10→D0 | Tight | 3645 | 121.50 | 35 / 20 |
| B10→D0 | Standard | 3644 | 121.47 | 35 / 20 |
| B10→D0 | Wide | 3648 | 121.60 | 35 / 20 |

The complete standing bake uses all 108,566 generated solids. Session movement
uses a conservative four-metre plan broadphase (37,654 unchanged solids), at every
height including roofs; independent checks query the full scene. Bodies leaving
the independently transcribed route envelope fail immediately.

Exact packed order completion is a separate observed AI issue, [U-174](../backlog/U-174.md).
This proof requires clear-room arrival, Hold and continued travel; it does not
claim every crowded move pattern finishes without another command.

## Floor and escape evidence

- Six exact basement/surface starts survive restart/retry; initial enemy sockets
  retain their authored floors and an unsupported y4 socket is rejected by name.
- Actual Session AI perception, wire Move/Hold/Fire and Three screen picking
  distinguish B6 y0/A6 y8 and retained bridge y16. Same-floor controls succeed.
- Real cover bake/runtime choices retain 14 valid lower and 14 valid upper
  witnesses, rechecked against the full scene; opposite-floor choices are refused.
- All 3,426 generated room/stair roof pieces stop 34,260 face/edge hitscan and blast
  probes. Real wire shots stop at B6's slab; a surface cannon blast does no B6 damage.
  Ordinary blast cover attenuation is preserved, not retuned.
- Desktop/mobile cameras pass 1,496 solves at 17 room/stair/road/bridge locations,
  including maximum mobile orbit distance and pitched views through real roof meshes.
- Exact independent endpoint cuts pass 616 bidirectional queries, with positive
  controls for both connections and all nine rooms. Every live adjacency in the
  remaining 1,014-polygon basement component stays off the surface/backing plane.
- 5,887 controller escape attempts cover shell/stair/balustrade/prop faces, reachable
  tops and retained surfaces. Surface starts cannot accept a lower basement landing.
  B9's inaccessible high top uses only fitting stances; floor probes reject access.
- Existing independent shell/furniture/stair dimensions, exact surface-solid
  preservation, insertion screening and rotating tank-sweep tests remain required.

## Reproduce

```sh
pnpm exec vitest run packages/tools/src/maps/qalatDepotTraversal.test.ts packages/tools/src/maps/qalatDepotIsolation.test.ts packages/tools/src/maps/qalatDepotEscape.test.ts
pnpm gen:qalat-depot
pnpm exec tsx packages/tools/src/capture-qalat-depot.ts
pnpm gen:nav
pnpm check:assets
pnpm check:packs
pnpm verify
pnpm sim-run --scenario mission --all-missions --seeds 3
```

The [26 standing-eye captures](../../artifacts/qalat-depot/captures.json),
[construction manifest](../../artifacts/qalat-depot/construction.json) and
[plan](../../artifacts/qalat-depot/plan.svg) retain exact geometry/render hashes.
All captures use two draws, below the 300-draw ceiling. Regenerate the large ignored
level/surface JSON with the commands above before opening the review viewer.

All 20 focused tests and `pnpm verify` pass: typecheck, lint, **352 test files /
3,509 tests**. Depot/nav generation, capture regeneration and asset/pack budgets pass.
Checkpoint CI run 38765168129 passed 3,508 tests and failed only the stale U-172
construction metadata; the regenerated construction/capture manifests correct it.
The [PR checks](https://github.com/JoshuaLRay/Sandline/pull/345/checks) record final
latest-head CI; all four required jobs must pass before the authorized merge.
The active Qalat diagnostic matrix remains **0/6** (ordinary gameplay losses);
no replacement-mission matrix or human verdict is claimed.
