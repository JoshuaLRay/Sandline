# Map and mission creation standard

**Current direction — owner, 2026-10-16 ([ADR-023](../adr/023-flexible-mission-routes.md)):**
maps should generally offer several meaningful ways to approach their
objectives, but the number, shape, separation and interaction of those
approaches vary by mission. Three approaches — a direct assault, one with
observation or another positional advantage, and one allowing a flank,
infiltration or different strategy — are a useful **starting point**, not a
requirement. Tactical opportunity and environmental believability matter more
than route counts. This governs every future map and every future redesign.

**Approved layouts are not redesigned.** The Qalat Road and the Kestrel Dam were
designed under the earlier rule (owner, 2026-10-04: three physically distinct
lanes, a separated flank) and keep their approved geometry, separators,
crossing registers and proofs unless an approved map revision changes them.
Their records still use the [declared-separation rules](#declared-separation-and-crossings)
below, which remain the method for any map that chooses to separate a route.

[Campaign](CAMPAIGN.md) owns story, progression and mission order. This document
owns shared map rules. Each `MISSION-NN.md` owns objectives, opposition and
pacing; each `maps/<world-id>.md` owns its geometry, approach graph and
validation plan. [Map index](maps/README.md) lists scope and
[the template](maps/TEMPLATE.md) supplies the per-map record. Design targets are
not claims about shipped geometry.

## 1. Approaches: guidance, not a formula

An **approach** is a way the squad can get from where it starts to where an
objective is decided, with its own tactical character (exposure, range,
information, time, risk). Design approaches from the objective and the place,
then count them — never the reverse.

- **Usually more than one.** Most objectives should be reachable in at least
  two ways that ask for different decisions. A map record states how many
  approaches it has and why that number suits the mission.
- **Three is a starting point.** A direct assault, an observation/overwatch
  position, and a flank or infiltration is a good first sketch. Change it when
  the place suggests something better.
- **Approaches may share ground.** They may intersect, merge, diverge, overlap
  and reconnect. A shared courtyard, a road the ridge path crosses twice, or a
  village where every alley connects are all legitimate. A map must not feel
  like disconnected corridors added to satisfy a count.
- **Not always the same roles.** Height is not always the second approach (it
  may be a rooftop, a minaret, a ruined tower, a dam crest or nothing). The
  third is not always a hidden flank or a tunnel (it may be a river bed at
  night, a supply-truck ride, a distraction, a stealth line past sleeping
  sentries, or a timing window).
- **Linear is allowed when justified.** An escort down one valley road, a
  defence, a breach through a single compound gate: say so in the map record
  and give the linear space internal choice (cover pockets, side rooms,
  alternate firing positions, a choice of when to commit).
- **Approaches change after the objective.** The return trip may close a route,
  open another, add a counterattack or a vehicle, or move the threat to the
  rear. Plan it as its own stage.

Useful approach patterns (combine and vary; none is mandatory):

| Pattern | Shape | Good for |
|---|---|---|
| Separated lanes | Distinct routes with few, named links | Clear commitment, split squads (Qalat, Kestrel) |
| Braided | Two or three paths that cross and re-cross | Flexible manoeuvre, fluid firefights |
| Layered vertical | One footprint with street, interior and roof levels | Urban and compound fights, close-quarters overwatch |
| Hub and spokes | A central objective reachable from several directions | Raids, assassinations, demolition |
| Funnel with pockets | One main axis with side rooms and ledges | Escorts, defences, breaching |
| Open ground | Wide terrain with scattered cover and dead ground | Long-range overwatch, vehicle threats, recon-first play |
| Stealth line | A route that is only quiet if timed and unseen | Infiltration, sentry play (needs the awareness model, STEALTH-AWARENESS.md) |

## 2. Environmental design

Make the place first; make it fight well second; never make it fight well by
making it unbelievable.

- **Landforms with real elevation.** Ravines, valleys, cliffs, ridges,
  embankments, terraces, wadis and spoil heaps. Footprints follow landforms and
  structures, not stripes in a rectangle; technical floor bounds never define
  playable terrain.
- **Buildings worth entering.** Interiors that matter (rooms, stairs, roofs,
  basements) as well as exteriors; doors and windows that create angles.
- **Varied engagement distances.** Close, medium and long within a mission, so
  every weapon type — and every loot build — has somewhere to shine.
- **Natural concealment and cover.** Walls, rocks, vehicles, crops, rubble,
  dead ground, shadow and smoke, placed where they would actually be.
- **Reconnaissance before contact.** Places to look from before committing;
  enemies visible doing something (patrolling, guarding, resting) so players
  can plan, especially with the stealth model.
- **Defensible positions and interesting enemy placement.** Enemies placed where
  defenders would be — sangars, rooftops, gate posts, overwatch — with depth,
  patrols, reserves and readable intent.
- **Believable military and civilian places.** Compounds, villages, roads,
  bridges, warehouses, depots, fortifications, airstrips and dams that look
  built for a purpose.
- **Coordinated six-person tactics.** Somewhere for one fireteam to support while
  the other moves; positions that reward a split squad without forcing one.
- **Return routes.** The way back may differ: what was cleared, what arrives,
  what the escort can climb.
- **Navigation for everyone.** Every approach a human may take, bots must be able
  to take on order, and escorted characters (POWs) must be able to follow,
  regroup and retreat. Use stairs and ramps the navmesh and controller handle;
  avoid widths and drops that strand bots.

## 3. Variety across the campaign

Each mission brief fills one row of this ledger, so the season does not repeat
itself. No mission must use every element; neighbouring missions should not
share the same dominant mix.

| Element | M1 Qalat Road | M2 Kestrel Dam | M3–M10 |
|---|---|---|---|
| Open terrain | Road valley | Gorge and west bank | — |
| Urban | — | — | — |
| Interior | Underground depot | Dam galleries | — |
| Long-range overwatch | Ridge | Canal overlook | — |
| Close quarters | Depot, outpost | Gate house | — |
| Vehicle threat | Tank on the return | Technicals | — |
| Stealth opportunity | Concealed insertion | Concealed gravel bar | — |
| Defence | — | — | — |
| Escort / extraction | POW escort out | Helicopter extraction | — |

## 4. Authored geography

Give each approach a readable entrance, changing views and a distinct arrival.
Place spawn out of every enemy sight line with credible topography or
architecture; prove that concealment with geometric tests rather than a grace
period or an arbitrary wall.

Build specifications must include coordinate conventions, measured route spines,
floor/ceiling heights, room and doorway dimensions, physical boundaries, exact
cover/enemy placement, patrols, triggers, supplies, return paths and checkpoint
behaviour. Separate required engine work from capabilities already present.
Stacked floors require height-aware spawning, objectives, orders, cover and saves.

Mission 1 specifics (owner, 2026-10-04) are kept in
[its record](maps/qalat-road.md): a fully underground flank with no
intermediate surface exits, whose large rooms may be wider than a surface route.

## 5. Declared separation and crossings

Use these rules **only where a map record declares an approach separated** from
another (a sealed flank, an overlook you must not drop from, a stage you cannot
leave). Qalat and Kestrel declare all three of their routes separated. Every
declared boundary must be real; an undeclared one is not tested.

- Use continuous cliffs, retaining walls, rock masses, buildings or equivalent
  collision-backed boundaries. Low cover, textures, vegetation, labels and
  different floor heights alone do not establish a boundary.
- A crossing is a localized passage with a stable ID, endpoints, landmark,
  width, direction and tactical purpose. List **every** connection between
  declared-separate approaches; repeated gaps or a long open edge fail the rule.
- Shared start and objective spaces are bounded convergence areas; mark where
  approaches split and rejoin. Multi-stage maps record the graph per stage.
- Movement and firing connections are different. An overlook can fire over a
  barrier while its collision prevents walking, vaulting or dropping. A one-way
  drop counts as a crossing.
- Check barriers against actual movement: step-up, auto-vault, falling,
  crouching, rubble and reachable roofs. Seal ends and the surrounding floor so
  going around a barrier does not create an undocumented route.
- Width means usable clearance after cover and props. Never make a narrow
  passage so tight that bots or the POW cannot pass, regroup or retreat.

## 6. Authoring sequence

1. Write the mission brief and copy the map template before building the level.
   Record constraints, objective stages, footprint, the **approach graph** (how
   many approaches, where they share ground, which if any are declared
   separate), the variety-ledger row, support sight lines and start/objective
   convergence.
2. Block out collision and navigation first. Walk every approach and the return;
   test any declared crossings and attempt illegal shortcuts across declared
   boundaries. Record changed targets.
3. Place cover and opposition to give each approach its cost and reward. Name
   what each overwatch position can see and what it cannot. Keep enemy spawns
   screened and patrols on authored traversable paths.
4. Integrate objectives, escort routes, checkpoints, vehicle clearance and
   mission triggers. Test the return trip as its own stage.
5. Dress the proven layout. Visual boundaries match collision, entrances read
   from ground level, props create no unintended shortcuts. Follow
   [art direction](../art/direction.md) and the performance budgets.
6. Use [Adding a mission](../COMMANDS.md#adding-a-mission-u-073) for
   registration, generation and checks. Keep evidence and pending owner review
   in the task card; keep topology changes synchronised with the map record.

## 7. Review criteria

A design review (before building) and a playtest review (after) judge the same
criteria. Each map record answers every row; "not applicable" needs a reason.

| # | Criterion | Design question | Evidence |
|---|---|---|---|
| R1 | Tactical choice | Are there at least two meaningfully different ways to take each objective, or a stated reason for linearity with internal choice? | Approach graph; playtest route log |
| R2 | Environmental believability | Would this place exist, built this way, for this purpose? Do boundaries look like what they are? | Top-down sketch; client captures |
| R3 | Engagement variety | Does the mission mix close, medium and long fights? | Encounter table with ranges |
| R4 | Reconnaissance | Can the squad see something useful before contact? | Named recon positions and what they see |
| R5 | Enemy placement | Are defenders where defenders would be, with depth and readable intent? | Socket/patrol table |
| R6 | Squad coordination | Is there a reason (not an obligation) to split or support? | Support positions and their targets |
| R7 | Return and stages | Does the way back or the next stage play differently? | Stage graph |
| R8 | Navigation | Can bots on orders and the escort take every approach and the return? | Nav proofs, headless runs |
| R9 | Campaign variety | Does the variety-ledger row differ from neighbouring missions? | Ledger row |
| R10 | Replayability | Would a replay run reasonably choose a different approach or loot stop? | Playtest notes |

## 8. Playtest evaluation

A map's owner playtest judges R1–R10, not whether a route count is met. Record,
per run: who took which approach (human and bot), where the squad split, where
it stalled, which engagements happened at what range, whether recon changed the
plan, how the return played, bot or escort navigation failures, and whether the
players would try a different approach on a replay. Keep verdicts pending until
the owner gives them; a green test is never a verdict.

## 9. Acceptance and evidence

For each implemented map, record:

- **Positive paths:** every approach end to end and back, every legal crossing
  in its allowed directions, and actual player/bot/escort traversal with cover in
  place.
- **Negative paths (declared separations only):** points along each declared
  boundary cannot cross locally; returned navigation paths between separated
  approaches pass a listed crossing or convergence area. Isolation checks
  temporarily exclude declared crossings and confirm no other adjacency remains;
  pair them with real-controller attempts to vault, drop or go around.
- **Support check:** named overwatch positions have useful lines of fire onto
  named threats; protected pockets prevent total domination.
- **Mission regression:** stage progression, spawn/trigger reachability, escort,
  checkpoint retry, vehicles, extraction and patrol paths still work.
- **Technical checks:** regenerate nav/cover when inputs change; run
  `pnpm verify`, `pnpm exec tsx packages/tools/src/level-check.ts`,
  `pnpm check:assets`, `pnpm check:packs`, relevant mission simulations and the
  required latest-head CI. A per-map route-graph check that reads each map's
  declared approaches and separations replaces the implicit three-lane
  assumption ([U-219](../backlog/U-219.md)).
- **Human evidence:** annotated top-down approach view and client views of
  boundaries, overwatch angles and key arrivals; the playtest record of §8.
