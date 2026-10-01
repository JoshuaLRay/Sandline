# Mission 1 — brief (draft for owner approval)

Status: **DRAFT, owed to the owner by U-065.** Everything marked *(default)* is my choice where the owner's decisions
([CAMPAIGN.md](CAMPAIGN.md)) do not say; say which to change and I change them before any level is built. Nothing here is
built yet. Working title: **"The Qalat Road"** *(default)*.

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

Footprint about 60,000 m² *(default; the feasibility spike U-076 allows ~4× the slice without U-081, so the level is
built in two steps: a 4× first cut, then larger once U-081 lands)*: three lanes, each about 40 m wide, about 480 m long
from the start in the south to the compound in the north, and the same valley back.

| Lane | Character | Offers |
|---|---|---|
| West: the dry riverbed | low, long cover, boulders | quiet approach; a patrol walks it; the tank's route home is *not* here |
| Centre: the road | open, hard-packed | fastest; the garrison's MG nest covers it from the compound wall; the tank comes down this on the way back |
| East: the terraces | stepped fields and walls | slow, good cover and sight lines onto the compound's east gate; a sniper post *(default)* |

Three sight lines worth building around: the MG nest down the road; the compound's east gate from the upper terrace; the
road bend where the tank first appears (a long approach where rockets and cover matter, U-079).
Squad start: south edge, all six together. Exit: the extraction point at the start end of the road *(default: the same
place they started, so the way home is the way in)*.

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
- Only a human playtest can say whether 30–45 minutes is right, whether the three lanes feel different, whether the
  tank is fair, and how the POW feels to look after. No verdict is claimed without one.

## Decisions I need from the owner (defaults in italics above)

1. **Title and setting details**: *"The Qalat Road"*, a valley and a walled compound.
2. **The optional radio operator** (calls the tank early): keep, or drop for simplicity.
3. **Tank behaviour if the squad avoids the road**: *it drives to the extraction point and the squad must destroy it* (above), or it should chase the squad.
4. **Extraction at the start point** (a loop) or a separate exit on the far side.
5. **Sniper**: *wait for the archetype*, or build it as part of this mission.
6. **Scale**: *4× first cut, grown after U-081* vs wait for the full ~10×.
