# U-227 — unregistered complete replacement bundle

Engineering evidence for [U-227](../backlog/U-227.md),
[PR #372](https://github.com/JoshuaLRay/Sandline/pull/372).
The accepted insertion/terrain/road/ridge/depot/outpost construction is composed
without changing tactical geometry. Candidate revision 2 and the existing
`qalat-outpost-construction` ID remain outside every live registry.

## Reproduction

```sh
pnpm gen:qalat-replacement
pnpm gen:qalat-replacement --check
pnpm exec vitest run packages/tools/src/maps/qalatReplacement.test.ts packages/tools/src/nav/cover.test.ts
pnpm exec vitest run packages/tools/src/maps/qalatSurfaceNav.test.ts packages/tools/src/maps/qalatSurfaceEscape.test.ts packages/tools/src/maps/qalatDepotNav.test.ts packages/tools/src/maps/qalatDepotTraversal.test.ts packages/tools/src/maps/qalatDepotIsolation.test.ts packages/tools/src/maps/qalatOutpostNav.test.ts packages/tools/src/maps/qalatOutpostTraversal.test.ts packages/tools/src/maps/qalatOutpostIsolation.test.ts packages/tools/src/maps/qalatOutpostCaptives.test.ts packages/tools/src/maps/qalatOutpostSession.test.ts packages/tools/src/maps/qalatOutpostRestore.test.ts
pnpm gen:qalat-outpost
pnpm exec tsx packages/tools/src/capture-qalat-outpost.ts
pnpm exec tsx packages/tools/src/capture-qalat-outpost.ts --replacement
pnpm gen:nav
pnpm check:assets
pnpm check:packs
pnpm --filter @sandline/client build
pnpm check:load-time
SANDLINE_LOAD_WORLD=qalat-road pnpm check:load-time
pnpm perf:frame
pnpm verify
```

`manifest.json` commits the compact candidate receipt. Level, surface, explicit
holdings mission and `BakedNav` JSON are regenerated, never fetched from the
registered mission. `reloadReplacement` validates payload/input hashes and IDs,
then loads the serialized Detour export with ordinary `bakedBytes`/`NavMesh.load`.
Changed geometry, render data, starts, holdings, nav bytes/cover, mission world,
plan or manifest hashes are refused. The plan preserves the accepted standing
agent, 0.1/0.05 m voxels, 1024-cell tiles, bounds and absence of traversal links.

The shared export seam retains the registered solo/vault policy unless given
an explicit tiled-standing plan. Cover uses a conservative local box index;
exact support/body/floor predicates and output order remain intact. Registered
bakes must regenerate byte-for-byte unchanged, including their cover arrays.

## Proof and limits

Focused validation passes **146 tests across 13 files**. The generator and full
byte-freshness check pass; registered nav regeneration and the 18 existing
outpost captures remain unchanged. Candidate captures cover 22 standing-eye
anchors, each at two draw calls and 1,080,622 triangles. Final full verify,
load/frame and latest-head CI results are linked from [PR #372](https://github.com/JoshuaLRay/Sandline/pull/372/checks).

The candidate test builds and serializes the complete bundle, compares its
receipt to the committed manifest and independently rebakes its nav. The full
generator freshness check repeats nav, cover and render export byte-for-byte.
It checks all starts, three-lane/room/gate witnesses and six holdings against
connected intended floors; backing-plane and roof witnesses stay disconnected.
The actual standing controller follows insertion, road, ridge/bridge and depot
routes both ways across tiled seams. Every exported cover point retains support
and a clear standing body; basement, road, ridge and outpost floors are included.
Existing composed traversal/isolation and U-225/U-226 Session regressions retain
their detailed room, route, escape, captive and restart coverage.

The render surface uses lossless gzip JSON transport with a decoded-content hash;
all exact coordinates, normals, colours and indices survive export/reload.
The staged JSON payloads total about 32 MB, including collision and navigation;
the tiled nav is 2,239,876 bytes and cover contains 9,389 points (243 low).
The bounded review reuses the complete collision-union surface and 18 accepted
outpost anchors, adding four standing-eye views at insertion, A6, R7b and B6.
No cutaway roofs or geometry substitutions are used. Streaming CI uploads the
bundle and all 22 PNGs as `qalat-replacement-review`. Review locally at
`/packages/tools/src/maps/outpost-review.html?replacement` after generation.
Captures and automation do not supply an owner quality verdict or prove target
hardware frame rate. This is construction packaging, not a full combat mission.

Relative to synchronized main `1125649c`, production level/mission/encounters/scripts,
registered nav/cover, campaign/lobby, save handling and deployment configuration
remain unchanged. The upstream migration in [#373](https://github.com/JoshuaLRay/Sandline/pull/373) is preserved. U-228–U-232 prepare
encounters, caches, flow and rehearsals; U-233 activates atomically and repeats
actual registered acceptance. U-118 presentation and U-119 owner playtest follow.

## Deployment observation — 2026-10-17

Main advanced to `1125649c1bc6880f17a39b5c62f0b44f482bf0f1` via migration
[#373](https://github.com/JoshuaLRay/Sandline/pull/373) during U-227 verification.
Synchronization preserves its retired Pages workflow, gated Worker publisher and
workflow-contract tests; U-227 adds only the candidate generation/capture step.
The four upstream cutover-contract tests pass locally. No accepted construction,
render/nav/cover input, holding, start or candidate receipt changed during sync.
All four CI jobs must run again on the synchronized U-227 head before merge.

At 20:30 UTC, <https://sandline.joshualray21.workers.dev/> returns HTTP 200 and
boots in Chromium as **SANDLINE 1125649**, built 20:27 UTC, with no JavaScript
errors. <https://sandline-host.fly.dev/healthz> reports healthy, protocol 74.
This verifies the existing live main build and supersedes the earlier Pages-only
availability observation. U-227's earlier Worker preview build failed; neither
that failed preview nor green test jobs prove a new production release.
After merge, check the actual Worker build stamp against current main; a skipped
publisher is not deployment success. These are automated availability/build
observations, without replacement activation or an inferred owner verdict.
