# U-234 playable Qalat WIP

The owner's 2026-10-17 U-233 clarification authorizes early playable access to
the current construction. U-228–U-232 gate production activation. U-119 remains
final acceptance; no early or final owner verdict is inferred here.

Target URL: https://sandline.joshualray21.workers.dev/?preview-qalat
Deployment is not established by a successful build or merge. The final live
result, build stamp and CI run are recorded in [PR #375](https://github.com/JoshuaLRay/Sandline/pull/375).

## What is playable

The generated U-227 bundle is loaded explicitly: `qalat-outpost-construction`,
revision 2, 110,509 collision solids, six authored insertion starts, the exact
render surface (including undersides), standing tiled nav and 9,389 cover points.
Bundle hash: `1d7728e30f3a44bf6445a0b1c35a693d16a960dbf62cedb81da09922adc824c4`.
The browser checks the level, surface, nav, cover, manifest and decompressed
render payload hashes before starting. Render indices are partitioned into bounded
spatial chunks with compact buffers copying the exact original vertex attributes, so camera/weapon rays skip
distant triangles without changing construction. A stale/mixed bundle fails visibly.

This uses the normal LocalServer/Session, network encoding, NetClient prediction,
controller, camera, weapons, friendly brain, squad orders and soldier switching.
There is one human and five bots, without the range's sparring client occupying
a second slot. The candidate is supplied only to the local client's lookup;
ordinary clients still reject unknown worlds.

Encounters, objectives, five caches, mission/script flow, rescue content, final
presentation and full production verification are unfinished. The preview is
explicitly disposable and has no campaign load/save callback. Reload resets it;
leaving returns to the normal home page. The registered campaign, live Qalat
revision, production nav/cover and saved data are unchanged.

## Controls

Click **Start WIP playtest**, then click the game to capture the mouse.

| Action | Control |
|---|---|
| Move / look | WASD / mouse |
| Sprint / jump or vault | Shift / Space |
| Crouch / prone | C / Z |
| Fire / aim and first person | Left / right mouse |
| Reload / equipment | R / 1–6 |
| Shoulder / exit first person | V |
| Squad order wheel | Hold Q, flick to an order, release; number keys address slots/teams |
| Soldier switching / settings | Esc, then **Take control** or Settings |

## Reproduction and evidence

```sh
pnpm exec vitest run packages/client/src/net/previewWorld.test.ts
pnpm --filter @sandline/client build
pnpm exec tsx packages/tools/src/check-qalat-preview.ts
pnpm verify
pnpm check:assets
pnpm check:packs
# After guarded merge and actual publication:
SANDLINE_EXPECT_SHA=<merged-main-sha> pnpm exec tsx packages/tools/src/check-qalat-preview.ts https://sandline.joshualray21.workers.dev/
```

The browser probe uses the existing perf probe’s explicit headless pointer-lock
fixture and standard keyboard/MouseEvent handlers. It does not test native browser
fullscreen/capture or supply an owner verdict. It asserts the intended world/revision/solids, five bots, normal
movement, authoritative ammo expenditure, first-person aiming, a visible order
wheel, accepted floor-aware hold order, soldier switching and the draw-call ceiling.
After the input assertions it freezes the last real frame through the explicit
`review-map` capture hook and reads the actual WebGL canvas before its buffer is
discarded. It saves the UI label/state in `artifacts/qalat-preview/evidence.json`
and the rendered canvas in `playing.png`; streaming CI
uploads them as `qalat-playable-wip`. The optional expected SHA checks the actual
published build stamp. These are engineering checks, not owner feedback or
U-233's full activation matrix.
