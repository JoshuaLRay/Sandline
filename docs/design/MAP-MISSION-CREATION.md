# Map and mission creation standard

Owner direction, 2026-10-04: campaign maps must have three **physically distinct**
lanes. Route 1 is the straightforward primary assault; route 2 overlooks and
supports it; route 3 is a separate, narrower flank. Routes 1 and 2 may have more
connections, but free lateral movement across the whole map is not three lanes.
This supersedes the equal-width/open-lane interpretation in the original mission
1 brief. It applies to the Qalat rework and every forthcoming campaign mission.

[Campaign](CAMPAIGN.md) owns story, progression and mission order. This document
owns shared map rules. Each `MISSION-NN.md` owns objectives, opposition and pacing;
each `maps/<world-id>.md` owns its geometry, crossings and validation plan.
[Map index](maps/README.md) lists scope and [the template](maps/TEMPLATE.md) supplies
the required per-map record. Design targets are not claims about shipped geometry.

## Authored geography and mission 1 amendment

Owner follow-up, 2026-10-04: lane separation alone is insufficient. Mission 1
requires a full authored replacement with a naturally concealed insertion,
winding main road, climbing ridge and giant underground basement passage, with
enemies on every path. [Its construction specification](maps/qalat-road.md)
replaces the earlier rectangular valley plan.

For all campaign maps, make the playable footprint follow landforms, structures
and encounter spaces, not three stripes inside a large rectangle. Give each
route a readable entrance, changing views and a distinct arrival at the objective.
Place spawn out of every enemy-route sight line with credible topography or
architecture; prove that concealment with geometric tests rather than a grace
period or arbitrary wall. Technical floor bounds do not define playable terrain.

For mission 1 specifically, the flank is fully underground with no intermediate
surface exits. Its large rooms may be wider than a surface route; its circulation
is narrower and isolated. This is an explicit refinement of the narrow-flank rule,
not a reason to shrink a giant basement into a crawl tunnel. Other mission types
may use another flank form under their own per-map record.

Build specifications must include coordinate conventions, measured route spines,
floor/ceiling heights, room and doorway dimensions, physical boundaries, exact
cover/enemy placement, patrols, triggers, supplies, return paths and checkpoint
behaviour. Separate required engine work from capabilities already present.
Stacked floors require height-aware spawning, objectives, orders, cover and saves.

## Three route roles

| Route | Purpose | Shape and cost | Relationship to other routes |
|---|---|---|---|
| 1 — assault | Obvious, direct way to the objective | Broad enough for squad movement and fighting; exposed to the main defences, with cover to advance | Deliberate passages to route 2; no casual access to route 3 |
| 2 — overlook/support | Cover route 1's advance and give a different attack angle | Continuous elevated or offset route, with usable firing positions, cover and exposed transitions | Several named links to route 1 are allowed; visibility over it does not imply walkable access |
| 3 — flank | Commit to a separate approach and reach a side/rear entrance | Narrower than both other routes, screened, with bends and passing/holding pockets; travel or isolation is its cost | Default: zero intermediate links to 1 or 2; at most one justified, named exception per map |

All three must be viable approaches. The assault must work without mandatory
support; the overlook must provide useful support without seeing every threat;
the flank must offer a positional reward without being an empty, risk-free bypass.
A small squad can use a single route; a split squad can cooperate across 1 and 2.
Do not require clearing every enemy, holding a position or using every route just
to make the layout work. Preserve the campaign's 30–45 minute target and objective
freedom where applicable; measure time in play instead of inflating corridor length.

## Physical separation and crossings

- Use continuous cliffs, retaining walls, rock masses, buildings or equivalent
  collision-backed boundaries. Low cover, textures, vegetation, route labels and
  different floor heights alone do not establish a boundary.
- A crossing is a localized passage with a stable ID, endpoints, landmark, width,
  direction and tactical purpose. List **every** connection. Routes 1 and 2 can
  have several, but each must be separated by a meaningful stretch of blocked
  boundary; repeated gaps or a long open edge fail the rule.
- Shared start and objective spaces are allowed as bounded convergence areas.
  Mark exactly where routes split and rejoin. A long common arena through most
  of the approach is not an endpoint exemption. Multi-stage maps must record the
  route graph for each stage; objective hubs must not dissolve the next approach.
- Movement and firing connections are different. An overlook can fire over a
  barrier while its collision prevents walking, vaulting or dropping into route 1.
  A one-way drop counts as a crossing and consumes the same connection allowance.
- Check barriers against actual movement: step-up, auto-vault, falling, crouching,
  rubble and reachable roofs. Seal ends and the surrounding floor so going around
  a barrier or hugging the map boundary does not create an undocumented fourth route.
- Width means usable clearance after cover and props. State design ranges in each
  map; use squad/escort traversal to tune them. Never make a narrow flank so tight
  that bots or the POW cannot pass, regroup or retreat.

## Authoring sequence

1. Write the mission brief and copy the map template before building the level.
   Record constraints, objective stages, footprint, route graph, separators, all
   crossings, support sight lines and objective/start convergence bounds.
2. Block out collision and navigation first. Walk all three approaches and return
   paths; test the intended crossings and attempt illegal shortcuts. Finalize
   crossing positions and widths from these checks, recording any changed targets.
3. Place cover and opposition to reinforce each route's cost and reward. Name what
   each support position can see on route 1 and what terrain blocks from it. Keep
   enemy spawns screened and patrols within authored traversable paths.
4. Integrate objectives, escort routes, checkpoints, vehicle clearance and mission
   triggers. Test the return trip separately: the same graph may play differently
   after the objective, but barriers do not disappear unless the brief says so.
5. Dress the proven layout. Visual boundaries must match collision, entrances must
   read from ground level, and props must not create climbable shortcuts. Follow
   [art direction](../art/direction.md) and the existing performance budgets.
6. Use [Adding a mission](../COMMANDS.md#adding-a-mission-u-073) for registration,
   generation and checks. Deliver evidence and pending owner review in the task
   card; keep topology changes synchronized with the per-map document.

## Acceptance and evidence

A lane's start-to-end reachability only proves that a path exists. It does not
prove that the path stays in its lane or that lateral shortcuts are blocked.
For each implemented map, record:

- Positive paths: each lane end to end and back, every legal crossing in its
  allowed directions, and actual player/bot/escort traversal with cover in place.
- Negative paths: representative points along every separator cannot cross
  locally; returned navigation paths between lanes must pass a listed crossing
  or convergence area. A long detour through a legal endpoint is allowed. Check
  path segments/region transitions, not just whether a global path exists.
- Isolation check: temporarily exclude the declared crossings/convergence regions
  in a test graph and confirm no other inter-lane adjacency remains. Pair nav
  checks with real-controller attempts to vault, drop or go around the boundary.
- Support check: named overlook positions have useful lines of fire onto named
  assault threats; protected pockets and blind spots prevent total domination.
- Mission regression: stage progression, spawn/trigger reachability, escort,
  checkpoint retry, vehicles, extraction and authored patrol paths still work.
- Technical checks: regenerate nav/cover when inputs change; run `pnpm verify`,
  `pnpm exec tsx packages/tools/src/level-check.ts`, `pnpm check:assets`,
  `pnpm check:packs` and relevant mission simulations plus required latest-head CI.
  Existing tools do not yet enforce this entire topology contract automatically;
  add focused isolation/path checks with the implementation.
- Human evidence: annotated top-down route/crossing view and actual client views
  of barriers, support angles and flank exits; play both approach and return with
  a split squad and an escorted group. Record lane readability, route commitment,
  congestion, usefulness and duration. Keep verdicts pending until actually given.
