# <Map title> — <world-id>

Status: <proposal / implemented; owner review and evidence separately>.
Mission brief(s): <links>. Implementation card(s): <links>.
Shared rules: [Map and mission creation](../MAP-MISSION-CREATION.md).

## Constraints and current state

- Existing geometry versus requested design; date/source of decisions.
- Footprint, coordinate orientation, start/extraction and bounded convergence areas.
- Objective stages, vehicle/escort needs, checkpoints and performance constraints.

## Routes and boundaries

| Route | Entry → waypoints → exit | Usable width target | Elevation, cover, exposure | Tactical cost/reward |
|---|---|---|---|---|
| 1 — assault | | | | |
| 2 — overlook/support | | | | |
| 3 — flank | | Narrower than 1 and 2 | | |

Include a graph/top-down sketch for each distinct stage layout. Show separators,
shared areas and every crossing; distinguish fire sight lines from movement edges.
For each boundary, specify physical construction, end seals and prevention of
vault/drop/roof/perimeter shortcuts.

## Crossing register

| ID | Routes/endpoints | Location/landmark | Width | Direction | Purpose |
|---|---|---|---|---|---|
| <ID> | | | | | |

State the total 1↔2 crossing count, the 3↔1/2 count (default zero), and the bounds
of start/objective convergence. Justify any single intermediate flank connection.
State explicitly that no other movement links are permitted.

## Combat, support and mission flow

Name overlook firing positions, their assault targets and blind spots. Describe
flank reward and opposition, patrol routes, spawn screening, objective entry,
return/escort paths, tank clearance where applicable and retry behaviour.

## Implementation and verification

List actual level/encounter/script/mission, generation and test entry points.
Separate proposed dimensions from measured final ones. Record positive paths,
negative boundary/path-transition checks, controller shortcut attempts, support
sight lines, squad/POW bottlenecks, stage/vehicle/retry regressions and budgets.
Include annotated overview and client capture locations plus reproducible commands.
Record actual results, latest-head CI and owner verdict; leave unrun checks pending.
