# Code map

Where each system lives, so an agent can open the right file instead of
searching. Verified against main on 2026-10-09. In the tables, `shared/`,
`server/`, `client/`, `tools/` and `bot/` mean `packages/<name>/`, and the Data
column is relative to `packages/shared/src/data/`. If you move or add a major system, update its
row in the same PR.

## Read this first — the three wrong assumptions

1. **`packages/server/src/session/Session.ts` is the game.** `Session.step()`
   (≈L5700 of ~7,000) runs every authoritative tick, and nearly every gameplay
   feature is a method on it: `applyFire`, `applyThrow`, `updateRevives`,
   `updateKits`, `assignSlot`, `applySwitchCharacter`, `orderFrom`,
   `updateSupplies`, `captureMissionCheckpoint`, `driveTank`, `buildSnapshot`.
   Its tests are the ~60 `packages/server/src/session/*.test.ts` beside it.
   Grep for the method; never read the file whole.
2. **`packages/shared/src/sim/Simulation.ts` (Rapier + bitECS) is a bootstrap**,
   used only by `sim-run`'s `fall`/`crowd` scenarios and the parity harness.
   Movement is `stepCharacter` in `CharacterController.ts`; collision is the
   box world in `sim/world.ts`. bitECS components matter only as the wire
   schema (`net/schema.ts`).
3. **`data/regions.json` / `sim/regions.ts` are Fly.io hosting regions**, not
   map regions. Map areas are `sim/areas.ts` and `sim/navigationRegion.ts`.

The in-page practice mode runs the same `Session` through
`packages/client/src/net/LocalServer.ts`, so server code is client code too.

## Simulation core

| System | Files | Data | Tests |
|---|---|---|---|
| Tick and room loop | `shared/src/sim/Clock.ts` (30 Hz), `server/src/session/SessionHost.ts`, `server/src/session/Registry.ts` | — | `Clock.test.ts`, `SessionHost.test.ts` |
| Character controller, vault, collision | `shared/src/sim/CharacterController.ts`, `sim/moveDefaults.ts`, `sim/world.ts` | `worlds/range.json` | `CharacterController.test.ts`, `shared/test/harness/characterParity.test.ts` |
| Stances (crouch, prone — ADR-016) | `CharacterController.ts`, `sim/muzzle.ts` (`eyeStance`), `server/src/net/lagComp.ts` | `weapons.json` `proneSpreadScale` | `server/src/session/stanceOrigin.test.ts`, `lagComp.test.ts` |
| Character separation | `shared/src/sim/characterSpace.ts`, `server/src/ai/locomotion/avoidance.ts` | `server/src/ai/locomotion/avoidance.json` | `characterSpace.test.ts` (shared and server) |
| Deterministic maths | `shared/src/math/trig.ts`, `trigTable.ts` (generated), `prng.ts`, `angles.ts`; `eslint.config.js` bans the rest | — | `trig.test.ts`, `prng.test.ts` |

## Weapons and combat

| System | Files | Data | Tests |
|---|---|---|---|
| Weapon definitions, spread, roles | `shared/src/sim/weapons.ts` | `weapons.json` | `weapons.test.ts`, `shared/test/harness/spreadParity.test.ts` |
| Firing, hitscan, lag compensation | `Session.ts` `applyFire`/`aiShoot`, `server/src/net/lagComp.ts`, `shared/src/sim/muzzle.ts`, `client/src/weapons/drawnMuzzle.ts` | `weapons.json` | `server/src/session/fire.test.ts`, `aiFire.test.ts` |
| Damage, downed, bleed-out, revive | `shared/src/sim/damage.ts`, `Session.ts` `updateRevives` | `damage.json` | `damage.test.ts`, `enemyDownedTarget.test.ts` |
| Suppression | `shared/src/sim/suppression.ts`, `client/src/ui/suppressionLook.ts` | `suppression.json` | `suppression.test.ts` (shared, server) |
| Grenades, rockets, projectiles | `shared/src/sim/ballistics.ts`, `Session.ts` `applyThrow`/`stepProjectiles`/`detonate`, `client/src/weapons/pouchTrigger.ts` | `projectiles.json` | `ballistics.test.ts`, `server/src/session/projectiles.test.ts` |
| Equipment slot 5 (C4, claymore, smoke, concussion, sensor) | `Session.ts` `placeCharge`/`detonateCharges`/`mineTripped`/`updateSensors`, `shared/src/ai/perception.ts` (smoke), `client/src/weapons/weaponKey.ts` | `projectiles.json`, `classes.json` `equipment` | `claymore.test.ts`, `smoke.test.ts`, `concussion.test.ts`, `sensor.test.ts`, `client/src/weapons/c4.test.ts` |
| Health kits | `Session.ts` `updateKits`, `damage.ts` | `damage.json` `kit`, `classes.json` `interactionTimeScale` | `client/src/weapons/healthKit.test.ts`, `server/src/ai/friendly/heal.test.ts` |
| Pickups, loot, exchange, dual primary | `shared/src/sim/pickups.ts`, `Session.ts` `takePickupAt`/`dropHeld`/`placePickup` | `pickups.json`, `classes.json` `dualPrimary` | `pickups.test.ts`, `authoredLoot.test.ts`, `dualPrimary.test.ts`, `leftHandedLoot.test.ts` |
| Mounted MGs | `shared/src/sim/emplacement.ts`, `Session.ts` `mount`/`fireMounted` | `emplacements.json` | `emplacement.test.ts` (shared, server) |

## Squad

| System | Files | Data | Tests |
|---|---|---|---|
| The six characters | `shared/src/sim/classes.ts`; design `docs/design/squad-roster.md` | `classes.json` (`slotDefaults`, `ads`, `firstPerson`, `speedScale`) | `classes.test.ts` (shared, server) |
| Slots, possession, join/leave/resume | `Session.ts` `assignSlot`/`releaseSlot`/`resumeSlot`/`giveBrain`, `shared/src/net/resume.ts` | `resume.json` | `Session.test.ts`, `client/src/weapons/joinSlot.test.ts` |
| Commanders and switching | `Session.ts` `commanderOf`/`applyAssignCommander`/`applySwitchCharacter`, `client/src/ui/menu/commandModel.ts` | — | `commanders.test.ts`, `switch.test.ts` |
| Orders (move, attack, hold, regroup, revive) | `shared/src/sim/orders.ts`, `orderFeet.ts`, `Session.ts` `orderFrom`/`applyOrder`, `server/src/ai/friendly/orders.ts` | `orders.json`, `trees/friendly.json` | `orders.test.ts` (shared, server, friendly) |
| Spread, fire discipline (aggression), marks | `shared/src/sim/tactics.ts`, `Session.ts` `applySpread`/`applyAggression`/`applyMark` | `squad.json` `spreadScales`, `orders.json` | `spread.test.ts`, `aggression.test.ts` |
| Held squad stance (U-153) | `shared/src/sim/tactics.ts` `STANCE_KINDS`, `Session.ts` `applyStance`/`holdStances`/`heldPace` | — | `stance.test.ts` |
| Fireteams, formation, bot fighting | `shared/src/sim/squad.ts`, `server/src/ai/friendly/formation.ts`, `server/src/ai/actions/friendly.ts` | `squad.json` | `formation.test.ts`, `fight.test.ts`, `attackCover.test.ts` |
| Escorted POW | `server/src/ai/actions/escort.ts`, `Session.ts` `orderEscort` | `trees/escort.json`, `enemies.json` `pow` | `escort.test.ts` |

## AI

| System | Files | Data | Tests |
|---|---|---|---|
| Behaviour trees, Brain, debug | `shared/src/ai/bt.ts`, `blackboard.ts`, `server/src/ai/Brain.ts`, `server/src/ai/debug.ts` | `trees/*.json` | `bt.test.ts`, `Brain.test.ts` |
| Enemy actions, aim, grenades, group flank | `server/src/ai/actions/rifleman.ts`, `combat.ts`, `grenade.ts`, `server/src/ai/aim.ts`, `group.ts` | `enemies.json`, `server/src/ai/group.json` | `rifleman.test.ts`, `mg.test.ts`, `group.test.ts` |
| RPG gunner (launcher, wind-up, rockets) | `server/src/ai/actions/rpg.ts`, `Session.ts` `launcherHands` | `enemies.json` `rpg` (`launcher`), `trees/rpg.json` | `rpg.test.ts`, `tools/src/scenarios/rpg.test.ts` |
| Director and spawner | `shared/src/sim/director.ts`, `server/src/ai/director/director.ts`, `spawner.ts` | `director.json` | `director.test.ts`, `spawner.test.ts`, `encounterPressure.test.ts` |
| Encounters, sockets, patrols, reserves | `shared/src/sim/encounters.ts`, `navigationRegion.ts`, `server/src/ai/nav/BoundedRegion.ts` | `encounters/*.json` | `encounterSockets.test.ts`, `stagedEncounter.test.ts`, `guardSockets.test.ts` |
| Perception (sight, sound, memory) | `shared/src/ai/perception.ts`, `stimuli.ts`, `memory.ts`, `Session.ts` `perceive` | `stimuli.json`, `memory.json` | `perception.test.ts`, `hearing.test.ts` |
| Cover | `server/src/ai/cover.ts` (runtime), `tools/src/nav/cover.ts` (baked) | `server/src/ai/cover.json` | `cover.test.ts`, `layerCover.test.ts` |
| Pathing and floors | `server/src/ai/locomotion/followPath.ts`, `server/src/ai/floor.ts`, `server/src/ai/nav/NavMesh.ts` | `locomotion/follow.json` | `followPath.test.ts`, `floor.test.ts` |
| Tank and anti-armour | `shared/src/sim/vehicle.ts`, `Session.ts` `driveTank`/`fireTanks`, `server/src/ai/armour.ts`, `server/src/ai/actions/armour.ts` | `enemies.json` `tank`, `server/src/ai/armour.json` | `tank*.test.ts`, `server/src/ai/friendly/armour.test.ts` |

## Missions and campaign

| System | Files | Data | Tests |
|---|---|---|---|
| Objectives (incl. upload and lever) | `shared/src/sim/mission.ts` (`OBJECTIVE_TYPES`), `server/src/session/mission.ts`, `server/src/ai/actions/lever.ts` | `missions/*.json` | `mission.test.ts`, `stages.test.ts`, `qalatMission.test.ts` |
| Event scripts | `shared/src/sim/events.ts`, `scripts.ts`, `server/src/session/events.ts` | `scripts/*.json` | `server/src/session/events.test.ts` |
| Registering a mission | `shared/src/sim/campaignRegistry.ts`; steps in `docs/COMMANDS.md` "Adding a mission" | `levels/`, `missions/`, `encounters/`, `scripts/` | `campaignRegistry.test.ts`, `tools/src/scenarios/missionFiles.test.ts` |
| Campaign and replay runs, carry-over | `shared/src/sim/campaign.ts`, `Session.ts` `handOff`/`applyRunChoice`, `client/src/ui/runChoice.ts` | `campaign.json` | `runKinds.test.ts`, `loadoutCarry.test.ts` |
| Checkpoints, restore, map revision | `server/src/session/checkpointWorld.ts`, `Session.ts` `captureMissionCheckpoint`/`retryMission`, `client/src/ui/restoreChoice.ts` | `levels/*.json` `mapRevision` | `checkpointWorld.test.ts`, `incompatibleRestore.test.ts` |
| Capture, prisoners, rescue | `server/src/ai/actions/capture.ts`, `Session.ts` `updateCaptures`/`completeRescue` | `damage.json` `capture` | `capture.test.ts`, `rescue.test.ts` |
| Persistence, XP, ranks | `server/src/persistence/CampaignDatabase.ts` (SQLite), `server/src/persistence/xp.ts`, `shared/src/sim/progression.ts`, `scoreboard.ts` | `progression.json` | `CampaignDatabase.test.ts`, `xp.test.ts` |
| Supply caches | `shared/src/sim/supplyCaches.ts`, `shared/src/net/supplyWire.ts`, `Session.ts` `updateSupplies`, `client/src/ui/supplyChoice.ts` | `supply-caches.json` (+ mission scripts) | `supplyCaches.test.ts`, `commanderSupplies.test.ts` |

## World and maps

| System | Files | Data | Tests |
|---|---|---|---|
| Level format and kit | `shared/src/sim/level.ts`, `kit.ts` | `levels/*.json`, `kit.json` | `level.test.ts`, `kit.test.ts` |
| World registry, squad starts | `shared/src/sim/world.ts`, `campaignRegistry.ts` | `worlds/range.json` | `world.test.ts`, `squadStarts.test.ts` |
| Areas and stacked floors | `shared/src/sim/areas.ts`, `navigationRegion.ts`, `server/src/ai/floor.ts` | `levels/*.json` | `areas.test.ts`, `stackedAreas.test.ts` |
| Navmesh bake (`pnpm gen:nav`) | `tools/src/gen-nav.ts`, `tools/src/nav/bake.ts` → generated `server/src/ai/nav/baked/` | — | `tools/src/nav/nav.test.ts` (fails when stale) |
| Level checker | `tools/src/level-check.ts` (`pnpm exec tsx packages/tools/src/level-check.ts`) | `levels/*.json` | `level-check.test.ts` |
| Qalat construction generators (write `artifacts/`, not production) | `tools/src/gen-qalat-*.ts`, `tools/src/maps/` | `tools/src/maps/*.json` | `tools/src/maps/*.test.ts` |

## Netcode

| System | Files | Tests |
|---|---|---|
| Protocol and version | `shared/src/net/protocol.ts` (`PROTOCOL_VERSION`) | `protocol.test.ts` |
| Bitstream, snapshot, delta | `shared/src/net/BitStream.ts`, `quantize.ts`, `schema.ts`, `snapshot.ts`, `delta.ts` | `BitStream.test.ts`, `delta.test.ts` |
| Transport | `shared/src/net/Transport.ts`, `Connection.ts`, `server/src/net/WsTransport.ts`, `client/src/net/WsTransport.ts` | `Transport.test.ts` |
| Host, rooms, interest | `server/src/main.ts`, `config.ts`, `session/Registry.ts`, `session/relevance.ts` | `relevance.test.ts`, `hostAi.test.ts` |
| Prediction, interpolation, clock sync | `shared/src/net/prediction.ts`, `interpolate.ts`, `clockSync.ts`, `client/src/net/NetClient.ts`, `bot/src/BotClient.ts` | `prediction.test.ts`, `bot/test/convergence.test.ts` |
| Client modes | `client/src/net/LocalServer.ts`, `RemoteServer.ts` | `LocalServer.test.ts` |

**Bumping the protocol:** change `PROTOCOL_VERSION`, then update the tests that
pin it exactly (`grep -rn "PROTOCOL_VERSION).toBe" packages`).

## Client

| System | Files | Tests |
|---|---|---|
| Entry and frame loop | `client/src/main.ts` (~3,400 lines; grep, don't read) | `check:load-time`, `perf:frame` |
| Assets, packs, LOD | `client/src/assets/loader.ts`, `packs.ts`, `lod.ts`, `instances.ts` | `loader.test.ts`, `packs.test.ts` |
| Camera (third/first person, ADS, mobile orbit) | `client/src/camera/cameraSolve.ts`, `springArm.ts`, `mobileOrbit.ts`, `client/src/input/viewState.ts` | `cameraSolve.test.ts`, `viewState.test.ts` |
| Input and keys | `client/src/input/LocalInput.ts`, `client/src/weapons/weaponKey.ts` (no rebinding yet) | `LocalInput.test.ts` |
| HUD, compass, squad rows | `client/src/ui/hud/Hud.ts`, `hudModel.ts`, `client/src/ui/SquadPanel.ts`, `missionHud.ts`, `scopeOverlay.ts` | `hudModel.test.ts`, `missionHud.test.ts` |
| Order wheel and markers | `client/src/ui/OrderWheel.ts`, `orderPick.ts`, `OrderMarkers.ts` | `OrderWheel.test.ts` |
| Lobby, menus, briefing | `client/src/ui/Lobby.ts`, `RoomLobby.ts`, `client/src/ui/menu/Menu.ts`, `client/src/ui/onboarding/Briefing.ts` | `menu.browser.test.ts` |
| Mobile spectator-commander | `client/src/ui/MobileCommand.ts`, `mobileSpectate.ts` | `MobileCommand.browser.test.ts` |
| Audio, callouts, voices (data in `audio/*.json`) | `client/src/audio/engine.ts`, `callouts.ts`, `shared/src/audio/` | `callouts.test.ts`, `voiceCues.test.ts` |
| Soldiers and tank rendering | `client/src/character/humanoidSoldier.ts`, `assetSoldier.ts`, `remoteSoldiers.ts`, `tankModel.ts`, `launcherLook.ts` (RPG gunner's carry and wind-up) | `humanoidSoldier.test.ts`, `remoteSoldiers.test.ts` |
| Weapon feel (recoil, reload, effects) | `client/src/weapons/recoil.ts`, `reloadPose.ts`, `effects.ts`, `rocketFx.ts` (rocket trail, launch flash) | `recoil.test.ts`, `rocketFx.test.ts` |
| QA panels (`?qa`) | `client/src/ui/TuningPanel.ts`, `WeaponPanel.ts`, `Netgraph.ts` | `qaMode.test.ts` |

## Tools and QA

| System | Files |
|---|---|
| Headless scenarios (`pnpm sim-run`) | `tools/src/sim-run.ts`, `tools/src/scenarios/` (floors in `scenarios/*.json`) |
| Bot client and parity | `bot/src/`, `shared/test/harness/`, `vitest.browser.config.ts` |
| Art as code (`gen:art` → `gen:assets`) | `tools/src/art/` (`pieces/`, `characters/`, `weapons/`, `vehicles/`), `tools/src/assets/pipeline.ts` |
| Budgets and checks | `tools/src/check-assets.ts`, `check-packs.ts`, `check-load-time.ts`, `perf-frame.ts`, `capture-*.ts` |
| Audio and voice | `tools/src/gen-audio.ts`, `tools/src/audio/`, `gen-voice.ts`, `tools/src/voice/`, `server/src/voice/` |

## Not built yet (searched 2026-10-09)

Player-drivable vehicles (the tank is enemy-only), helicopters, air strikes or
artillery, binoculars and laser designators, stealth/alarm states, night or
weather, difficulty settings, a radar or map screen, gamepad support and key
rebinding. Mission 2 (Kestrel Dam) exists only as design documents.
