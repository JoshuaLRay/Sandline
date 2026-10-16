# U-221 — Furnished outpost traversal and isolation

PR [#352](https://github.com/JoshuaLRay/Sandline/pull/352), first engineering
leaf of U-177. U-222 retains real captive/escort tank projectile and blast
shelters, below-west-stair hold/return and the carry-1 external-camera repair.
U-177/U-116 remain open; activation is U-117 and human quality U-119.

## Construction and proof boundaries

The scene is the unchanged complete furnished outpost: 110,507 collision solids
including road, ridge and depot. No production gameplay, geometry, generator
input, approved room/door dimension or protocol changes are needed. Registered
nav bakes and collision/render construction manifests regenerate unchanged.
Forty-two depot/outpost WebGL captures are refreshed; every view uses two draws.
These are construction evidence, not an owner look/play verdict.

`qalatOutpostTraversal.test.ts` uses a full standing bake and actual Session
soldiers, escorted POW, wire spreads and orders. A conservative movement
broadphase retains 7,684 exact solids at all elevations intersecting the
independently specified footprint plus four metres. Every tick checks standing
y8, support, solid clearance, vault absence, health and pairwise body separation.
Each actor must cross both masonry faces of its named gate inside the exact
opening, in outside/doorway/court order (or reverse), then hold on the far side.

The six-captive access fixture places five existing slots with the real capture
method and the original captive POW at the six retained holdings. One actual
Session rescuer walks from the antechamber to each rescue stand, returning
through the doorway between visits, without overlapping another captive.
This proves physical capacity/access; actual rescue and damage remain U-222.

**Order limitation (U-174).** A group Move's trailing formation can assign
destinations inside a side gate, and six closely packed exterior destinations
can block the POW. Side exits therefore finish with ordinary individual wire
Move staging, followed by Hold; there are no post-start body teleports. This
does not establish single-command packed formation completion. Inward arrival
uses the actual clear court rather than a smaller arbitrary test rectangle.

`qalatOutpostIsolation.test.ts` audits the full Detour adjacency component after
cutting exactly the three legal player approaches, retaining room/annex access
and rejecting external, basement, roof, terrain and backing-plane witnesses.
Real jump/vault/drop/stance sweeps validate airborne and grounded crossings
against independent room doors, exterior gates and east infill. Removed cell
wall and east infill controls must expose invalid crossings.

The same scene exercises production roof hitscan/blast consumers, desktop/mobile
camera collision, screen-picked wire Move/Hold and actual friendly movement,
and Session enemy perception with a same-room visible control. U-180's carry-1
raised-camera line remains an explicit U-222 input, not a passing claim here.

## Validation checkpoint

- Pass: typecheck, asset/pack budgets, depot/outpost/nav regeneration.
- Pass: 26 depot and 16 outpost captures, two draws each; manifests unchanged.
- Pass: all-mission diagnostic exits 0; greybox 1/6, mission-01 2/6, active
  Qalat 0/6 with ordinary soldier-dead outcomes.
- Pass: all six focused isolation tests (71.89 s), 557 component polygons,
  1,610 controller attempts, 2,970 roof probes and 560 camera solves.
- Focused traversal tests are being finalized. Early traversal
  failures exposed the fixture arrival-box and narrow-pad order limits above;
  they are not recorded as successful complete runs.
- Full `pnpm verify` and required latest-head CI are pending.
