# U-175 — Outpost shell engineering evidence

Draft [#346](https://github.com/JoshuaLRay/Sandline/pull/346) constructs the
isolated shell on the completed U-173 depot/surface. The active campaign remains
unchanged; U-117 activates the replacement and U-119 owns human quality acceptance.

## Design reconciliation

The owner approved the bounded 1 m east turning pocket on 2026-10-15. The exact
east wall occupies the original R9 reference (56,8,370); the retained stair/landing
now reaches the fixed gate via the exterior shoulder and a clear x57..61 turn.
The gate remains (56,8,374). North/east returns bound the pocket.

The owner authorized divider A on 2026-10-15, conditional on accommodating six
prisoners total. The exact cell stays12×14m (168m²); the divider occupies
z395.4..396 and the antechamber's clear north face is395.4. The original POW
keeps(16,8,402), with five carried-prisoner reservations at(12,8,400),
(20,8,400),(12,8,404),(20,8,404),(12,8,408). All are supported at y8,
stand clear of collision and each other, and preserve the inside four-by-four
landing x14..18/z396..400. Actual nav/controller access to each holding and
external body-ray protection for all six pass focused tests. These are physical
reservations; production placement/mapping and forced-Mission1 routing remain
U-144/U-178, with activationU-117. Captured squad characters occupy their existing
slots; after rescue the group is still six soldiers plus the original escort.

## Geometry and routes

Independent tests prescribe all room bounds, gate widths/heads, wall thickness,
window sill/head/jambs, barred cell window, solid ceilings and every reserve
service turn. Tests check the complete collision world as well as the shell,
so inherited rock cannot be mistaken for usable room space.

Reversible standing controller paths cover the south road, west depot service
entry, ridge shoulder/east gate, barracks, refuge, ante/cell, radio room and all
reserve bends. The north gate is the annex's sole connection; sealing the three
player gates rejects a reserve/outpost shortcut to X. Solid room/annex roofs and
perimeter tops have no standing nav route from the approaches. The approved
outside turn has four clear metres and its returns reject sprint/jump escape.
The single-goal R8 (70,12,350) ↔ court controller path passes both ways on
the retained last stair. Independent solid conservation finds 107,225 unchanged
boxes, 1,341 affected boxes and zero removed solids outside the authorized cuts.

The geometry uses exact three-dimensional cuts within the courtyard, gate joins,
approved pocket and reserve interiors. Material below y8 stays. An initial annex
capture/controller failure exposed inherited rock; exact corridor/room carving
fixed it. An initial north vestibule rim also blocked the inside gate throat and
was removed across its full prescribed eight metres.

## Captures and reproduction

- `pnpm gen:qalat-outpost` — passes; 110,444 total boxes, 504 shell boxes.
- `CHROMIUM_PATH=/usr/bin/chromium pnpm exec tsx packages/tools/src/capture-qalat-outpost.ts`
  — all ten standing-eye captures pass footprint, support, hash and rendered solid
  roof checks; two draws and 1,079,986 triangles per full-scene view, below 300 draws.
- `pnpm gen:qalat-depot` plus its capture command — all 26 views pass; retained
  hashes and byte-for-byte artifacts (two draws, 1,069,134 triangles each).
- `pnpm gen:nav` — passes; registered world bakes unchanged.
- `pnpm typecheck`, `pnpm lint`, `pnpm check:assets`, `pnpm check:packs` — pass.
  Initial asset pack remains 3,745,044 / 80,000,000 bytes.
- `pnpm sim-run --scenario mission --all-missions --seeds 3` — exits 0;
  greybox 1/6, mission-01 2/6, active Qalat 0/6 (ordinary soldier-dead losses).
- A pre-authorization `pnpm verify` run reported the original exact-antechamber
  failure, then was superseded/stopped after the owner approved changed dimensions
  and six capacity; it is not a completed verification result.
- Final approved-head `pnpm verify` and all four latest-head CI jobs remain pending.

The compact [manifest](../../artifacts/qalat-outpost/construction.json),
[plan](../../artifacts/qalat-outpost/plan.svg) and
[capture measurements](../../artifacts/qalat-outpost/captures.json) are committed.
View the [court](../../artifacts/qalat-outpost/south-gate-court.png),
[antechamber](../../artifacts/qalat-outpost/antechamber.png),
[cell](../../artifacts/qalat-outpost/cell.png),
[refuge](../../artifacts/qalat-outpost/refuge.png) and
[reserve bend](../../artifacts/qalat-outpost/reserve-bend.png).
Large exact level/surface JSON is regenerated, not committed. The browser viewer
renders the complete collision union with roof undersides, without clipping roofs.

## Retained obligations

U-176 builds every courtyard/room furnishing and the water tower, verifies hostile/
patrol/supply clearances and resolves the delegated V3 gun sight conflict. U-177
must prove seven-actor traversal/isolation/escape and **actual Session captive and
released/escorted POW** tank-projectile and wall/roof blast-cover shelter, compared
with ordinary open damage, including the below-west-stair hold and legal route.
Empty rays, generic health fixtures and these captures do not discharge that
obligation. U-174 packed move completion remains separate. Human quality U-119
is pending; no human look/play verdict is claimed here.
