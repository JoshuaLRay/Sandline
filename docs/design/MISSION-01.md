# Mission 1 — The Qalat Road

Status: the original mission brief was **approved by the owner on 2026-10-02**.
The level, encounters, script and mission are implemented (U-092–U-095), followed
by elevation/art work (U-097/U-096); owner gameplay review remains pending.
**Owner amendment, 2026-10-04:** replace freely interchangeable lanes with distinct
assault, overlook/support and narrow isolated flank routes. The map rework below
is documented but not yet implemented. Other approved mission decisions stand.
[CAMPAIGN.md](CAMPAIGN.md) owns campaign decisions; the
[map creation standard](MAP-MISSION-CREATION.md) governs this and future maps.
Working title: **"The Qalat Road"**.

## 1. Premise

Afghanistan, late 2001. An allied prisoner is held in a walled compound on the far side of a valley, and a convoy route
home runs back through the same valley. The squad frees him, brings him out alive, and is met on the way home by an
armoured vehicle it has to destroy before it can reach the extraction point **with all seven alive**.

## 2. Objectives

A stage is a set of objectives that may be done in any order (U-074); a stage is finished when its required ones are.

| # | Stage | Objective | Type | Required | Fails on | Checkpoint |
|---|---|---|---|---|---|---|
| 1 | Approach | Reach the compound (any lane) | `reach` (who: any) | yes | squad death | on entering the compound's outer ring |
| 2 | The compound | Free the prisoner | `rescue` (hold E beside the POW) | yes | squad or POW death | on freeing him |
| 2 | The compound | Silence the compound's radio operator *(default)* | `destroy` (a group of one) | **optional**: it holds back the tank's early warning | | none |
| 3 | The way home | Destroy the tank | `destroy` (the tank group) | yes | squad or POW death | when it is destroyed |
| 3 | The way home | Reach the extraction point with the POW and everyone standing | `reach` (`who: all`, `escort: true`) | yes | squad or POW death | none: ends the mission |

Not every enemy has to be cleared: nothing requires killing the garrison; stealth and speed through a quieter lane are valid.
Failure is the first death of a squad character or the POW (Q4); a retry goes back to the last checkpoint with the POW
restored (U-075).

## 3. Map

The authoritative map record is [maps/qalat-road.md](maps/qalat-road.md): route
graph, usable widths, physical boundaries, exhaustive crossing register, support
sight lines, convergence areas and implementation checks. The current playable
valley is about 120 × 200 m; retain that footprint for the lane rework. Expansion
toward ~60,000 m² is separate and must preserve route separation.

| Route | Location | Role and connections |
|---|---|---|
| 1 — primary assault | Centre road | Direct, broad approach under the MG's frontal threat; tank return route |
| 2 — overlook/support | East terraces | Connected higher ground with useful fire onto route 1 and the east gate; three named passages to route 1 |
| 3 — flank | West dry riverbed | Narrower, screened, winding route to the west gate; **zero intermediate connections** to routes 1 or 2 |

The start and compound are bounded shared spaces; between them collision-backed
barriers make routes distinct. Different textures, low cover and elevation alone
are insufficient. The previous equal-width (~40 m each) lane prescription is
superseded by the 2026-10-04 direction. Passage positions/widths in the map record
are blockout defaults to verify, not claims of implemented or playtested geometry.

Preserve the MG road line, upper-terrace/east-gate support angle and northern tank
bend. Start and extraction stay at the south end, with all six starting together;
all routes must support the return journey with the POW.

## 4. Opposition

| Group | Archetypes | Where | Trigger | Notes |
|---|---|---|---|---|
| Garrison | riflemen ×6, MG ×1 | the compound, garrisoned (U-011 postures) | on the squad entering the outer ring | alerted by shots; the radio operator, if alive, calls the tank early |
| Road patrol | riflemen ×3 | the road, patrolling | on start | a warning if met |
| Riverbed patrol | riflemen ×3 | the west lane | on start | |
| Terrace sniper *(default)* | sniper | the east terraces | on start | the archetype exists in the schema but has no row yet, so this waits: **default is a rifleman until the sniper is built** |
| Counter-attack | riflemen ×4 | from the north, behind the compound | on the POW being freed | |
| The tank | tank ×1 (U-066) | enters at the road's north end and drives the road south (U-067) | on the POW being freed, delayed 20 s *(default)*; arrives sooner if the radio operator is alive | the set piece: the squad is walking home with the POW and must find cover and fight it (U-079); leaving by another lane does not escape it, it drives to the extraction point and fires at what it sees |

If the squad leaves by the west or east lane, the tank still comes down the road and parks at the extraction point: the
squad has to destroy it to extract either way. *(default)*

## 5. The new element

The escorted POW (U-075). It is taught before it is tested: freeing him is the first thing that happens after the
garrison fight, and the first stretch of the way home is quiet and short, long enough to see him follow, to hold him
(`hold`) behind a wall and to send him (`move`) with the squad. The tank is then the test: keep him alive in the open.

## 6. Campaign state

- Assumes no prisoners; it is the first mission. A squad character downed and captured here (U-061/U-062) is held for the
  next *campaign-run* mission as the rules say; the POW is not part of the prisoner pools (U-072).
- Grants: the mission is complete on extraction; each soldier's end loadout is carried to mission 2 (U-077); XP as today.
- Replaces the vertical-slice mission-01 in the season; the slice stays as the test/QA mission (the assumption in CAMPAIGN.md).

## 7. Verification

- `sim-run --scenario mission` loads and plays it headless at both budgets (3 seeds in CI, 20 for the rates); the
  expected completion rate is not guessed: it is measured and recorded, as for the slice, before any floor is set.
- Scenario tests: the rescue frees the POW; the POW follows, holds and goes on an all-squad order; the tank appears
  after he is freed and can be destroyed; the extraction needs all seven alive (POW dead → failed → retry restores him).
- Map validation also follows [the per-map acceptance plan](maps/qalat-road.md#implementation-handoff-and-acceptance): legal crossings, blocked shortcuts, support sight lines and escorted return paths.
- Only a human playtest can say whether 30–45 minutes is right, whether the three lanes feel different, whether the
  tank is fair, and how the POW feels to look after. No verdict is claimed without one.

## Decisions (approved 2026-10-02: the defaults in italics above, as suggested)

1. **Title and setting details**: *"The Qalat Road"*, a valley and a walled compound.
2. **The optional radio operator** (calls the tank early): keep, or drop for simplicity.
3. **Tank behaviour if the squad avoids the road**: *it drives to the extraction point and the squad must destroy it* (above), or it should chase the squad.
4. **Extraction at the start point** (a loop) or a separate exit on the far side.
5. **Sniper**: *wait for the archetype*, or build it as part of this mission.
6. **Scale**: *4× first cut, grown after U-081* vs wait for the full ~10×. The 2026-10-04 lane rework retains the current first-cut footprint; expansion is separate.
