# Campaign design

The home of the **Campaign design** epic (U-071 and its leaves): the missions, the maps and how they are strung
together. It is a living design document. Anything marked **Proposal** is a default for the owner to accept or change;
nothing marked so is decided. Status and order live in [BACKLOG.md](../../BACKLOG.md); each task has its own card.

Not to be confused with the **Campaign** *systems* epic (U-032, U-059 to U-065): saving the world at a checkpoint,
prisoners and the rescue objective. Those are built and are the campaign's tools, not its content.

## 1. What exists today (verified 2026-10-01)

**One real mission**, `mission-01` ("clear and hold the qalat"): five objectives on one level, one encounter file and
one event script. The grey-box `greybox-01` is its test twin. Everything below is data-driven unless noted.

| Piece | Where | State |
|---|---|---|
| Objective types | `OBJECTIVE_TYPES` in `shared/src/sim/mission.ts` | `clear-and-hold`, `reach`, `destroy`, `defend`, `survive`, `upload`, `rescue` |
| Enemy archetypes | `data/enemies.json` | rifleman, mg, rpg, sniper, officer, tank (armoured, on rails, path-driven) |
| Emplacements | `data/emplacements.json` | mounted MG nests, usable by either side |
| Encounters | `data/encounters/<world>.json` | groups, zones, postures, triggers (start, time, enter, group-dead, script), the director's budget for 1–6 humans |
| Event scripts | `data/scripts/<world>.json` | triggers incl. `upload-start`; actions: spawn/stop group, set objective, blockers, messages, callouts, loot (`pickup`), vehicle spawn/withdraw |
| Upload and lever | objective `upload` | enemy lever that cuts the upload (U-010) |
| Checkpoints | per completed objective | restore the whole world (enemies, spawner, loot, health, devices, tank); saved in the campaign file |
| Prisoners | U-061 to U-064 | capture after 2 s down, rescue objective, carried across missions in the campaign file |
| Squad | `data/classes.json`, `progression.json` | six named characters with classes; XP and ranks per soldier, per campaign |
| Campaign file | `server/src/persistence/CampaignDatabase.ts` | `completedMissions` (a list of ids), checkpoint, soldiers (rank, XP, captured) |
| Level format | `data/levels/<world>.json` + `tools/src/art` kit | pieces from a code-built kit, collision boxes, spawn zones, emplacements |
| Checks | `check:assets`, `check:packs`, `level-check`, `sim-run --scenario mission` | the last plays mission-01 headless with six bots |

**Gaps that matter to a campaign** (verified in code; the first two are what U-072 and U-073 are for):

1. **No flow between missions.** The campaign file stores which missions are done, but nothing yet decides which
   mission comes next, offers a choice, or carries a debrief from one to the next. The lobby lists one hard-coded
   world (`client/src/ui/Lobby.ts`).
2. **Adding a mission means editing about eight places by hand:** the world registry (`shared/src/sim/world.ts`), the
   mission list (`sim/mission.ts`), the encounter list (`sim/encounters.ts`), the script lookup (`sim/scripts.ts`), a baked navmesh
   (`server/src/ai/nav/baked`), the lobby entry, the level checker's join table (`tools/src/level-check.ts`), and the
   mission sim, which is fixed to `mission-01` (`tools/src/scenarios/mission.ts`).
3. **One map, one look.** The kit has dirt, road, walls, props and a compound; there is no second environment, no
   interiors, no night and no weather.
4. **No vehicles for the squad, no air, no stealth, no multi-stage maps** (a mission is one level).
5. **The friendly bots cannot yet fight armour** (the tank beats them in the mission sim). Any mission with a tank
   needs that first, or accepts that bots do not complete it.

## 2. Decisions the owner needs to make

Each has a **Proposal**. Answering them turns U-071 into a mission list and the rest into READY cards.

| # | Question | Proposal |
|---|---|---|
| D1 | **Premise and tone.** Where and when; what the squad is for; how serious. The shipped mission is a qalat compound, which reads as modern Afghanistan. | Keep it: a small multinational squad working through a valley campaign. No named real-world factions; the enemy is "the insurgents" in the data. |
| D2 | **Length.** How many missions in the first campaign. | **Five** for the first release: mission-01 plus four, so a campaign is about 2–3 hours of co-op play. |
| D3 | **Structure.** Linear, or a map with a choice of order. | **Linear**, with one branch point after mission 3 (two optional missions in either order). Simplest to test and to save (`completedMissions` already is a set). |
| D4 | **Pacing rule.** What each mission adds. | **One new thing per mission**, on top of everything before: m1 clear and hold (built), m2 rescue, m3 armour and mounted guns, m4 night or low visibility, m5 a finale that uses all of it. |
| D5 | **Map size and time.** | 8–15 minutes a mission, one level of roughly mission-01's footprint (about 200 x 100 m), at most one interior set piece. |
| D6 | **What carries over.** | Rank and XP, and prisoners (built). Not weapons or ammo: each mission starts from the class loadout, so a lost gun is never a campaign-ending debt. |
| D7 | **Failure.** | Retry from the last objective checkpoint, any number of times (built). A full restart returns to the mission's start. No permadeath. |
| D8 | **Difficulty.** | The director already scales enemy pressure from 1 to 6 humans; keep that as the only dial. No difficulty menu in the first campaign. |
| D9 | **Debrief and story.** | A text briefing before each mission (the objective list already carries labels) and a short after-action screen (exists for stats). No cutscenes, no voice (ADR-017). |
| D10 | **Art.** | Reuse and extend the code-built kit for each new level; real art is a separate later epic. |

## 3. Missions

Filled in as D1 to D5 are answered. A row is one mission; each becomes a design brief (the template in section 4)
and then a set of cards (level, encounter, script, mission, verification).

| # | Working title | New element (D4) | Map idea | Status |
|---|---|---|---|---|
| 1 | Clear and hold the qalat | clear and hold, upload, lever, tank | the qalat valley | **Built** (mission-01) |
| 2 | — | rescue | — | **Proposal:** a prisoner held in a village; this is U-065 |
| 3 | — | armour and mounted guns | — | Proposal, awaiting D1 to D4 |
| 4 | — | low visibility | — | Proposal, awaiting D1 to D4 |
| 5 | — | finale | — | Proposal, awaiting D1 to D4 |

## 4. Mission brief template

One short document per mission, in this folder, written before any level is built:

1. **Premise** in two sentences, and what the squad must do.
2. **Objectives in order**, each with its type, its failure and its checkpoint.
3. **Map:** footprint, the route, three sight lines worth building around, where the squad starts and exits.
4. **Opposition:** groups, archetypes, triggers and the set pieces (an emplacement nest, an armoured arrival, a counter-attack).
5. **The new element** (D4) and how the mission teaches it before it tests it.
6. **Campaign state:** which prisoners it assumes, what it grants.
7. **Verification:** what `sim-run` and the scenario tests must show, and what only a human playtest can say.

## 5. Order of work

1. **Now:** owner answers D1 to D5 (U-071). This also fixes the mission list in section 3.
2. **Plumbing that does not depend on content:** U-073 (register a mission in one place and make the checks and the
   mission sim run every registered mission) and U-072 (what comes next: mission order, the lobby, the debrief). Both
   can start as soon as the owner says go, and both make every later mission cheaper.
3. **Missions in order**, each a brief, a level, an encounter, a script and its verification, one PR per card. U-065
   (rescue) is mission 2 by default.
4. **Bots versus armour** before a mission whose bots must beat a tank.
5. **Owner playtests** of each mission before the next is built on it. No verdict is claimed without one.
