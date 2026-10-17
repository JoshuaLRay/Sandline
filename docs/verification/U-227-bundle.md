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

Production level/mission/encounters/scripts, registered nav/cover, campaign/lobby,
save handling and deployment configuration remain unchanged. U-228–U-232 prepare
encounters, caches, flow and rehearsals; U-233 activates atomically and repeats
actual registered acceptance. U-118 presentation and U-119 owner playtest follow.

## Deployment observation — 2026-10-17

Before this merge, GitHub Pages reports a successful deployment of main
`de5d22cd759a5b57401d0bf8cee6c4afaf0ffb4e` and serves HTTP 200 at
<https://joshualray.github.io/Sandline/>. Fly's
<https://sandline-host.fly.dev/healthz> reports healthy, protocol 74.
Main's `deploy-client` job skips Cloudflare upload because deployment is not
configured; its successful conclusion does not establish a Cloudflare release.
The U-227 Workers build also reports failure. The previously reported Cloudflare
authentication failure is not resolved or converted into deployment evidence.
These observations verify the existing deployment's availability, without
activating the replacement or inferring an owner verdict.
