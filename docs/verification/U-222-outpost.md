# U-222 — Live outpost shelters and captive screening

Engineering follow-up to [U-221](U-221-outpost.md); together they close U-177.
Activation remains U-117 and whole-mission human quality U-119. No human verdict
is claimed. Shelter results use actual Session actors, shells and damage; camera
results use the production desktop/mobile camera solves.

## Carry-1 camera screening

**Reproduced before any construction change.** The strengthened all-six
production-camera test fails on the original scene: 93 body-sample views of
carry-1 (12,8,400), all through the aligned antechamber east door and cell south
door. 15 views come from X4, 73 from R8 and 5 from the east pad. No other holding
is seen. Example cameras: X4 mobile (84,17.41,341.68) and R8 mobile (78.80,25.63,343.20).

**Repair.** §8.1's fixed-open cell door is built as `outpost-cell-door-leaf`, a
4×3 m, 0.12 m leaf standing open against the west jamb at x13.88..14, z396..400,
y8..11. It is outside the x14..18 landing. Every carry-1 line crosses x14 at
z398..398.7, below y10.4, so the leaf closes it with margin.

**Result.**
- All six holdings are screened from 37 observers: 5,550 cameras and 163,800 rays.
  The observers are the road, forecourt and south gate, the three bays, the X
  tank road, the basement, the ridge and R7/R8 descent, the side pads and B10.
- The holding, landing and furniture fixtures pass, as do U-221's six rescue
  stands, 18 joins, isolation and nav suites.

## Live tank-shell shelters (`qalatOutpostShelters.test.ts`)

**Fixture.**
- Five squad characters are taken prisoner at carry-1..5, then freed there by
  `freeCharacter`. A held prisoner is out of play under U-061 and takes no
  damage, so the freed soldier at each holding is the damageable actor.
- The POW is a real `pow` entity in the cell (captive), the refuge or B9.
- Respawn protection is run out and asserted absent before every shot.
- An inactive tank lays its turret, and `fireShell` → `stepProjectiles` →
  `detonate` does the rest with the tank's own cannon numbers.
- Origins: nine tank-road points (X1–X6/A8, A7) and fixture turrets at the
  three gate approaches (forecourt, east pad, west pad).

**Results.**
- **Obstruction.** 96 shells aimed at every sheltered body (six in the cell,
  the refuge escort and the B9 hold) are all stopped before they hurt anyone.
- **Walls.** Real shells strike the cell east wall from X5–X6, on the tank's
  own road through the south arch, and from the forecourt. They strike the
  refuge south wall from the east pad.
  - Carry-2 takes 15.06, carry-4 14.98 and the refuge escort 16.92.
  - That is exactly 0.2 of the same blast with only that wall removed (75.31,
    74.89 and 84.60).
  - An open-court soldier mirrored to the same range takes 75.33, 74.92 and 84.63.
  - A flown shell bursts on the wall face, where U-166's boundary rule covers
    both sides. So the court control uses the same shell 1 mm off the face.
- **Roofs.** None of the 84 gravity-compensated arcing lays from the 12 origins
  lands on the cell or refuge roof: each strikes the y14 perimeter, terrain or
  a wall first. The tank's own blast 1 mm above the roof does 7.72 to every
  cell body and 4.78 to the refuge escort. Without that roof the same blast does
  38.60 and 23.91.
- **Exposed control.** The same escorted POW standing in the open court on its
  §10.3 leg takes 80 from an ordinary X5–X6 shell.

## Below the west exit stair (`qalatOutpostTraversal.test.ts`)

On the standing nav, six soldiers and the escorted POW walk:
refuge → court lane → west door and pad → B10 covered mouth → both flights and
the switchback → B9 at y0. They hold there, then walk back to the refuge porch
and court.
- Every tick checks the legal route, no vault or stance change, no
  intersection and full health.
- 937 ticks, no failed order. The shelter matrix above covers the B9 hold.

## Found and recorded, not changed

- [U-223](../backlog/U-223.md): a standing eye on R9's east pad sees the refuge
  escort hold through the east gate and the refuge's open east door. It is an
  infantry/camera lane; no tank shell reached the hold. The decision is the
  owner's, with B (a low court screen) as the default.
- [U-166](../backlog/U-166.md) (existing): blast exposure at an exact
  impact face.

## Reproduction and validation

```
pnpm exec vitest run packages/tools/src/maps/qalatOutpostShelters.test.ts \
  packages/tools/src/maps/qalatOutpostTactical.test.ts \
  packages/tools/src/maps/qalatOutpostTraversal.test.ts
```

Then run `pnpm verify`, `pnpm gen:qalat-outpost`, the outpost capture runner,
`pnpm gen:nav`, `pnpm check:assets`, `pnpm check:packs` and
`pnpm sim-run --scenario mission --all-missions --seeds 3`.
