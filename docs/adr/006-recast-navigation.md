# ADR-006: recast-navigation-js for pathfinding

- **Status:** Accepted
- **Date:** 2026-09-16
- **Plan reference:** §2, E-3.1

## Context

Enemy and friendly AI need to path through levels, select cover positions, and
avoid each other locally. With six human slots plus roughly forty AI in a
session, pathing runs on the server every tick budget.

## Decision

`recast-navigation-js` — WASM bindings to Recast (navmesh generation) and Detour
(runtime queries). Navmeshes are baked offline in `packages/tools` as part of the
level pipeline, not generated at runtime.

## Consequences

- Recast is the industry-standard navmesh generator; baked output is predictable
  and inspectable, and bake time does not affect the runtime budget.
- Detour gives us corridor-based path following and off-mesh links (ladders,
  vaults, drops) without inventing them.
- Adds a second WASM module alongside Rapier. Both must initialize before the
  simulation can step, which the async init in T-0.10 must account for.
- Navmesh generation becomes a build step. Changing level geometry requires a
  re-bake, so the level pipeline (E-4.3) and the navmesh bake must be wired
  together or they will silently drift.

## Alternatives rejected

- **Waypoint graph.** Cheaper to build and query. Rejected: cover selection and
  local avoidance both want a surface, not a graph. Waypoints produce AI that
  visibly moves on rails, which is exactly the failure mode R3 warns about.
- **Hand-rolled navmesh generation.** Rejected: large, well-solved, and not where
  this project's novelty lies.
- **Runtime navmesh generation.** Rejected: unnecessary given static geometry
  (ADR-002 excludes destructibles), and it would consume server budget every
  session for a result that never changes.
