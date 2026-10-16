# <Map title> — <world-id>

Status: <proposal / implemented; owner review and evidence separately>.
Mission brief(s): <links>. Implementation card(s): <links>.
Shared rules: [Map and mission creation](../MAP-MISSION-CREATION.md).

## Constraints and current state

- Existing geometry versus requested design; date/source of decisions.
- Irregular playable footprint, coordinate orientation, concealed start/extraction and bounded convergence areas.
- Exact route spines, room/doorway dimensions, floor/ceiling heights and construction recipes; distinguish technical floor bounds from playable terrain.
- Objective stages, vehicle/escort needs, checkpoints and performance constraints.

## Approaches

How many approaches this map has and why that shape suits the mission
([standard §1](../MAP-MISSION-CREATION.md#1-approaches-guidance-not-a-formula));
linear maps state the justification and their internal choices.

| Approach | Entry → waypoints → arrival | Shares ground with | Usable width target | Elevation, cover, exposure, range | Tactical cost/reward | Declared separate? |
|---|---|---|---|---|---|---|
| <name> | | | | | | yes / no |

Include an approach graph or top-down sketch for each distinct stage, showing
shared areas, where approaches split and rejoin, and fire sight lines as
distinct from movement edges. Record the return trip as its own stage.

## Declared separations and crossings (only if any approach is declared separate)

For each declared boundary, specify physical construction, end seals and
prevention of vault/drop/roof/perimeter shortcuts
([standard §5](../MAP-MISSION-CREATION.md#5-declared-separation-and-crossings)).

| ID | Approaches/endpoints | Location/landmark | Width | Direction | Purpose |
|---|---|---|---|---|---|
| <ID> | | | | | |

State the crossing count between each pair of declared-separate approaches and
the bounds of start/objective convergence, and that no other movement links
between them are permitted.

## Review criteria and variety

Answer R1–R10 of [the standard §7](../MAP-MISSION-CREATION.md#7-review-criteria)
and fill this mission's row of the variety ledger (§3).

## Combat, support and mission flow

Enumerate fixed cover, enemy sockets/counts, patrols, supplies and event timing.
Name overwatch firing positions, their targets and blind spots, and recon
positions and what they reveal. Describe each approach's reward and opposition,
enemy awareness posture (unaware, guarding, patrolling — STEALTH-AWARENESS.md),
patrol routes, spawn screening, objective entry, return/escort paths, vehicle
clearance where applicable, loot opportunities once approved, and retry behaviour.

## Implementation and verification

List actual level/encounter/script/mission, generation and test entry points.
Specify engineering prerequisites, stacked-floor behaviour and checkpoint migration where needed.
Separate proposed dimensions from measured final ones. Record positive paths for
every approach, negative boundary/path-transition checks for declared
separations only, controller shortcut attempts, overwatch sight lines, squad/POW
bottlenecks, stage/vehicle/retry regressions and budgets.
Include annotated overview and client capture locations plus reproducible commands.
Record actual results, latest-head CI and owner verdict; leave unrun checks pending.
