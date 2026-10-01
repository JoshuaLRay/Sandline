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
2. **Adding a mission used to mean editing about eight places by hand (U-073 reduced it to one registry entry, `shared/src/sim/campaignRegistry.ts`; see "Adding a mission" in `docs/COMMANDS.md`).** What it was: the world registry (`shared/src/sim/world.ts`), the
   mission list (`sim/mission.ts`), the encounter list (`sim/encounters.ts`), the script lookup (`sim/scripts.ts`), a baked navmesh
   (`server/src/ai/nav/baked`), the lobby entry, the level checker's join table (`tools/src/level-check.ts`), and the
   mission sim, which is fixed to `mission-01` (`tools/src/scenarios/mission.ts`).
3. **One map, one look, and a small one.** mission-01 is about 200 x 100 m and two lanes; the season needs three-lane maps roughly ten times that area. The kit has dirt, road, walls, props and a compound; there is no second environment, no
   interiors, no night and no weather.
4. **No vehicles for the squad, no air, no stealth, no multi-stage maps** (a mission is one level).
5. **The friendly bots cannot yet fight armour** (the tank beats them in the mission sim). Any mission with a tank
   needs that first, or accepts that bots do not complete it.

## 2. Owner decisions (answered 2026-10-01)

| # | Decision | Recorded |
|---|---|---|
| D1 | **Premise and tone** | **Afghanistan after 9/11; the enemy is the Taliban and al-Qaeda.** Grounded and tense. This changes the art as well as the story: the characters must look more realistic (see U-080). The owner's yardstick is *Conflict: Desert Storm*: ours read as scrawny and "drawn", too cartoonish even for PS2 standards. |
| D2 | **Length** | A first **season of ten missions of 30–45 minutes each**, built **one mission at a time**; they need not all exist at once. |
| D3 | **Structure** | **Straight line.** Past missions can be replayed. Two kinds of run (below). |
| D4 | **Pacing / objectives** | **Reimagined.** No clear-and-hold, and above all no holding a spot. Maps are bigger: **three lanes and much longer.** A mission's objectives can be done **in any order the players choose, where applicable**, and not every enemy has to be cleared. Mission 1 is a rescue and escort (section 3). |
| D5 | **Map size and time** | Three-lane maps, **30–45 minutes**, "fairly large": about **10x the area of mission-01's map** (at least where there are assets). |
| D6 | **Carry-over** | **Weapons, ammo and gear carry to the next mission**, but a pickup **replaces the gear in the character's current slot**. Replaying a mission is how players fetch different weapons for their squad. Rank and XP "are not all that important right now" and may eventually live on the player instead of the campaign soldier. |
| D7 | **Failure and restarts** | Eventually three choices: **restart from the last checkpoint, restart the mission, or return to mission select.** |
| D8 | **Difficulty** | The default: the director's budget (1–6 humans) is the only dial. May change later. |
| D9 | **Briefing and story** | The default: a short text briefing and debrief, no cutscenes, no voice. |
| D10 | **Art** | The default: reuse and extend the code-built kit for levels. (Characters are the exception: D1.) |

### Campaign runs and replay runs (from D3)

After each mission, completed **or failed**, the team leader chooses what to play next:

- a **campaign run** of the newest mission the campaign has reached; or
- a **replay run** of any mission already beaten.

The two keep **separate prisoner pools**: a character captured in a campaign run can only be rescued in the *next
campaign-run mission*, never in a replay; a character captured in a replay run can only be rescued in the *next replay
run*. A replay run is how players collect other weapons (D6).

## 3. Missions

The first season is ten missions. A row is one mission; each becomes a design brief (section 4) and then cards.

| # | Working title | What it is | Status |
|---|---|---|---|
| 1 | — | **A rescue and escort.** The squad frees an **unarmed POW** from the compound he is held in; he joins the squad as a seventh member who can be **commanded** (go / stay / follow) and **spectated** but not controlled. On the way back out a **tank rides in along the route home**: the squad must destroy it, then reach the extraction point **with all seven alive**. | Brief owed (U-065) |
| 2–10 | — | Not yet designed. One at a time, in order. | Open |

The existing `mission-01` (clear and hold the qalat) is the vertical slice. **Assumption, to confirm:** it stays
playable as the test and QA mission until the new campaign mission 1 replaces it, and is not part of the season.

### What mission 1 needs that does not exist yet

| Need | Card |
|---|---|
| Objectives done in any order, and not every enemy cleared | U-074 |
| An unarmed seventh friendly the squad commands and escorts (conflicts with ADR-001's "always six", see below) | U-075 |
| Feasibility of a three-lane map about ten times the area (navmesh, snapshots, enemy caps, client draw) | U-076 |
| Bots that can help destroy a tank | U-079 |
| The route home that the tank comes down, and extraction with "all seven" alive | in U-065 |
| Run types, mission select, campaign flow | U-072 |
| Registering a mission in one place | U-073 |

## 3a. Open questions this raises

| # | Question | Proposal |
|---|---|---|
| Q1 | **ADR-001 says the squad is always six.** The POW is a seventh, unarmed member who is *not* a slot (no player can take him), so the slot machinery (roster, picker, scoreboard) should not change. That is a deliberate exception and needs an ADR-001 addendum from the owner. | Add the addendum: a mission may add **escorted characters**: non-slot, non-playable, commandable (the existing move / hold / regroup orders read as go / stay / follow) and spectatable. The squad stays six. |
| Q2 | **Who is the "team leader"** who chooses the next run? | The player in slot 0 (the squad lead, Preach); if that seat is a bot, the room's host. |
| Q3 | **Does a failed mission end a campaign run?** The owner chooses after "complete **or failure**". | A failed campaign run lets the leader retry (the same mission) or choose a replay, never skip ahead. |
| Q4 | **"All 7 safely" when the POW dies.** | The mission fails if the POW dies, as it does when a squad character dies today (U-033), and the retry goes back to the last checkpoint. |
| Q5 | **"10x the size"** is an area; that is about 3.2x in each direction (roughly 630 x 320 m). | Confirm by the feasibility spike (U-076); keep the three lanes and a 30–45 minute pace as the aim, with the size following. |
| Q6 | **Carry-over of ammo** across a mission that was failed, replayed or restarted. | A mission starts from what the campaign file holds at its start; a restart or a retry returns to that, never to a half-spent state. |
| Q7 | **Where XP lives.** ADR-019 puts it on the campaign soldier; the owner expects it may move to the player. | Leave as is; not a campaign-design blocker. Note it when XP is revisited. |

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

1. **Decide Q1 to Q4** (this page). They block the escort (U-075) and the flow (U-072).
2. **Ready now, content-independent:** U-073 (register a mission in one place), U-074 (objectives in any order) and
   U-076 (the large-map feasibility spike). Together they decide what mission 1 can be.
3. **Then mission 1's parts:** the POW as an escorted friendly (U-075), the run types and mission select (U-072),
   bots against armour (U-079), carry-over (U-077), then mission 1 itself (U-065), whose brief comes first.
4. **In parallel, art:** the character rework (U-080) is its own line of work, since it decides how the campaign looks.
5. **In-mission menu** (U-078) once there is a mission select to return to.
6. **Missions 2 to 10**, one at a time, each a brief, a level, an encounter, a script and its verification, and
   an **owner playtest** before the next is built on it. No verdict is claimed without one.
