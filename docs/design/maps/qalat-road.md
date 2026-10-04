# The Qalat Road — map rework

World: `qalat-road`. Mission: [campaign mission 1](../MISSION-01.md).
Shared rules: [Map and mission creation](../MAP-MISSION-CREATION.md).
Documentation: [U-105](../../backlog/U-105.md).

Status, 2026-10-04: **rework design; geometry not yet implemented**. The owner
requires distinct assault, support and narrow isolated flank routes. The passage
count and width ranges below are concrete blockout defaults to validate in play,
not measured claims or a new owner playtest approval.

## Existing map and fixed mission constraints

U-092 built the valley, U-097 added connected elevation and U-096 added art. The
owner reports that freely switching lanes still defeats the intended layout.
The current route tests prove reachability, not isolation.

Retain the current approximately 120 × 200 m playable valley for this rework;
the larger ~60,000 m² campaign target is a separate expansion. Positive z runs
north from the south start/extraction `(0, -6)` toward compound centre `(0, 182)`.
The existing floor extends beyond the approach, so seal boundary bypasses rather
than treating the floor edge as a route wall. Keep the compound's west, south and
east entrances and the current mission stages: approach, rescue/optional radio,
then tank destruction and all-seven extraction. Preserve the tank's centre-road
path, encounter triggers and checkpoint semantics; validate clearance after edits.

## Intended topology

```text
                          NORTH: COMPOUND
                     west gate  south gate  east gate
                         |          |           |
                  F3 ----+          A3 -- C12-N--O3
                  |                 |           |
                  F2                A2 -- C12-M--O2
                  |                 |           |
                  F1                A1 -- C12-S--O1
                   \                |          /
                    SOUTH START / EXTRACTION HUB

                  route 3         route 1     route 2
                  riverbed        road        terraces
```

Lines show legal movement only, not scale or firing arcs. West-bank barriers
separate F1–F3 from A1–A3 without intermediate passages. Eastern retaining
boundaries separate A1–A3 from O1–O3 except at the three marked passages.

| Route | Geometry / usable width target | Role and cost |
|---|---|---|
| 1 — centre road, primary assault | About 14–20 m including fighting shoulders; protect the existing vehicle swept path | Straightforward south-to-south-gate advance, fastest geometry, road patrol and frontal MG pressure; cover supports bounding |
| 2 — east terraces, overlook/support | About 10–16 m between terrain/cover boundaries; retain connected lower/middle/upper elevation | Supports road advances and attacks the east gate; turns and exposed stair approaches cost time; cannot see through every bend or wall |
| 3 — west dry riverbed, flank | About 4–6 m, occasional 6–8 m passing/holding pockets still narrower than the other routes | Screened, winding approach to the west gate; patrol and restricted retreat reward commitment with a side angle |

These are clear walking/fighting widths after dressing, not three equal slices
of the footprint. Keep the riverbed lower than the banks and the terraces above
the road. Use tall continuous west-bank rock/retaining faces, with collision
beyond step/vault reach. No climbable prop chains, holes at sills, roof shortcuts
or roadside ramps connect the flank. Enclose the outer river edge as well.
Along the road/terrace boundary, use retaining faces and parapets that preserve
selected firing windows while blocking unlisted drops as well as climbs.

## Exhaustive crossing register

Locations are blockout targets in existing world coordinates; final passage
extents must be recorded after collision/nav validation. All are bidirectional
and remain open for the return journey.

| ID | Routes | Location / landmark | Clear width target | Purpose |
|---|---|---|---|---|
| C12-S | 1 ↔ 2 | Southern field stair, around z=44 | 3–4 m | Establish support for the first road advance |
| C12-M | 1 ↔ 2 | Middle field retaining-wall cut, around z=104 | 3–4 m | Reinforce or withdraw support at the middle fight |
| C12-N | 1 ↔ 2 | Upper terrace approach, around z=154 | 3–4 m | Coordinate the frontal/east-gate attack and regroup on return |

**Totals: three intermediate 1↔2 passages; zero intermediate 3↔1/2 passages.**
No other links, including one-way drops, are permitted. Continuous closed boundary
stretches between these openings make switching routes a deliberate travel choice.

The south convergence is limited to the start/extraction hub, z=-14..16 within
the authored valley edges; all three entries branch before z=20. The north
convergence is the compound outer-ring/entrance area, z=170..198 within authored
compound approaches. The riverbed enters from the west without spilling onto the
road before that area. Join boundary ends to the hub/compound geometry; do not
leave a walkable strip outside them. The compound is a shared objective space,
not a requirement to keep three separate corridors inside the rescue encounter.
Verify the existing `compound-ring` trigger still fires through every entrance.

## Combat and return journey

- Lower overlook O1 supports the southern road advance around A1. Middle overlook
  O2 covers road-patrol engagements around A2. Upper overlook O3 supports the
  northern road bend/A3 and compound east-gate approach. Use existing upper view
  near `(26, 164)` as a starting point, then record measured firing positions.
- Retain the compound MG's road threat and northern tank-bend visibility. Terrain
  bends, parapets and cover must leave blind spots: one terrace position cannot
  clear the road, west flank and compound alone. Enemy fire can contest support
  positions without making every terrace transition unavoidable lethal exposure.
- Keep the riverbed patrol on its own route. The flank's reward is the west-gate
  angle and reduced frontal exposure; its costs are a longer winding path, tight
  encounters and no mid-route reinforcement from the road. It is not a stealth
  system or a guarantee that the squad will avoid detection.
- After rescue, all three routes work southbound for six soldiers and the POW.
  Add protected passing/hold pockets within the flank, not lateral escape gaps.
  Check regroup and Tight/Standard/Wide spread at bottlenecks. A road/terrace
  support group can rejoin at a named passage; a flank group must use an endpoint.
- Preserve the quiet escort teaching stretch before the tank tests the squad.
  The tank stays on the road and can reach extraction regardless of the chosen
  return route. Destroying it remains required; the flank must not bypass that
  objective. Provide screened staging near the south hub for escort protection
  and a viable attack on the tank. Do not add an unlisted flank crossover for it.

## Implementation handoff and acceptance

Edit the level at `packages/shared/src/data/levels/qalat-road.json`; inspect its
matching encounter, script and mission JSON before relocating any relevant cover,
spawn, trigger or route waypoint. Use existing kit/collision primitives; regenerate
nav and cover after geometry changes. Extend `packages/tools/src/qalat-road.test.ts`
and the Qalat session/encounter tests with the shared standard's isolation checks.
Existing positive route tests must also show that each named route stays in its
corridor; reaching its endpoint by detouring through another lane is insufficient.

The implementation must demonstrate:

- Three full bidirectional routes; all three C12 passages usable by players,
  bots and the rescued POW; all six soldiers plus POW can pass/regroup on route 3.
- No undeclared boundary transitions. Sample both sides along each separator,
  verify navigation paths only cross at C12 passages or bounded hubs, and attempt
  controller vault/drop/perimeter shortcuts. Excluding declared junction regions
  leaves three distinct approach corridors.
- Measured support sight lines from O1/O2/O3 to the road and the upper east-gate
  angle; verified blind spots and a useful west-gate flank reward.
- Rescue, radio timing, tank movement/destruction, retry at each checkpoint and
  all-seven extraction still work after every choice of approach/return route.
- Full geometry/nav/asset checks and required CI; mission simulation at both
  budgets with 3 CI seeds and a 20-seed measured baseline. Prior recorded Qalat
  combat completion was 0/20 per budget; do not describe that as a passing mission
  completion floor or hide it by weakening gates.
- An annotated overview marking barrier extents, hubs and C12 openings, plus real
  client captures at each passage, a closed west-bank section, O1/O2/O3, flank
  bottlenecks and west gate. Play both directions and judge commitment, support,
  escort congestion and timing. Owner review remains pending.

The command sequence is in [the shared standard](../MAP-MISSION-CREATION.md#acceptance-and-evidence)
and [current Qalat review instructions](../../COMMANDS.md#qalat-road-terrain-and-mission-review-u-097).
Those existing review coordinates describe the current build, not proof of this
new topology. Update the review route/capture positions when implementing it.
