# Mission 2 — The Kestrel Dam

**Owner-approved design: U-127, 2026-10-09 (written 2026-10-05).** The owner asked for Mission 2 to be
designed in full detail, beyond Mission 1, with a creative new map and mission.
This brief summarises that design. The owner approved the existing design review
on 2026-10-09; specification §20 records the accepted proposals and preserved
extraction contract. Nothing is built or playtested.

The **[complete map and mission construction specification](maps/kestrel-dam.md)**
is authoritative for geometry, coordinates, construction, enemy sockets, events,
supplies, engineering prerequisites and verification. This brief is its summary.
[CAMPAIGN.md](CAMPAIGN.md) owns progression; [the shared standard](MAP-MISSION-CREATION.md)
governs route design.

## Premise and mission flow

Afghanistan, January 2002. Two anti-aircraft guns on the abutments of a
Soviet-built dam have closed the valley to helicopters. The squad must destroy
both guns with demolition charges, not the dam, free any squad members the enemy
captured earlier, beat the vehicles sent to retake the dam, and be lifted off the
dam's old helipad.

1. **Insert** at Willow Bar, a gravel bar under an overhang, hidden from
   everything upstream by the Prow buttress. An abandoned ammunition truck on the
   way out is a safe, silent place to practise a demolition.
2. **Approach** from Ford Court by one of three routes, or split across them:
   - **Route 1, the gorge road:** through the Cut Tunnel to a roadblock MG, past
     the aqueduct, through a ruined workers' camp, to the Yard Gate at the foot
     of the dam.
   - **Route 2, the canal:** the Keeper's Stair to a dry irrigation canal 16 m up
     the gorge wall. Window embrasures in rock galleries look down on all three
     road fights. It ends at the Intake House under the east battery.
   - **Route 3, the west bank:** a footbridge, a ledge path under an overhang,
     a ruined mill and frozen flats, then a climb up the dry spillway chute onto
     the west battery's plaza.
3. **At the dam**, in any order:
   - destroy the **Intake battery** gun (east abutment);
   - destroy the **Spillway battery** gun (west abutment);
   - free anyone held in the **Ops Block** at the dam's foot.

   The guns are on opposite abutments, so every squad crosses the dam: over the
   exposed crest, through the inspection gallery inside the concrete, or up the
   central shaft from the powerhouse.
4. **The first gun's blast** alerts the motor pool on the reservoir. Twenty
   seconds later two **technicals** race along the reservoir road and across the
   crest, with four riflemen following on foot. Sabotaging the fuel bowser first
   wrecks one of the two vehicles.
5. **Extract** at LZ Kestrel on the east abutment once both guns and both
   technicals are destroyed, with the whole squad standing. There is no return
   trip.

## Objectives and checkpoints

| Index / stage | Objective | Required | Checkpoint |
|---|---|---|---|
| 0 / 0 | Reach the Kestrel Dam (any of three arrival volumes, height-bounded) | Yes | On completion |
| 1 / 0 | Destroy the abandoned ammunition truck (training) | No | None |
| 2 / 1 | Destroy the Intake battery gun (`demolish`) | Yes | On completion |
| 3 / 1 | Destroy the Spillway battery gun (`demolish`) | Yes | On completion |
| 4 / 1 | Free every captured squad member (completes at once if none held) | Yes | On completion |
| 5 / 1 | Sabotage the motor-pool fuel bowser (`demolish`) | No | None |
| 6 / 2 | Destroy the technicals | Yes | On completion |
| 7 / 3 | Extract from LZ Kestrel, all six standing and none held | Yes | Mission success |

There is no holding a position, no timed defence, no forced waiting and no
requirement to clear every enemy. Stage 1 can be done in any order. A squad
death or all six down fails, as today. Details are in specification §11.

## The new element: demolition

The mission supplies the charges:

- **Plant:** hold Use for 4 s at a target's charge point. Holloway plants in 3.2 s.
- **Fuse:** 10 s, with a countdown and a warning to clear 10 m.
- **Blast:** 400 damage within 6 m, falling to nothing at 10 m. Friendly fire
  is real.

Holloway's C4 and Brennan's rockets can also destroy a target (400 structure
points), but nothing depends on them. The silent training truck teaches the
rule; the defended guns test it; the optional bowser rewards it.

## Map identity

| Route | Character | Width | Links |
|---|---|---|---|
| 1 — gorge road | Tunnel, causeway, camp, gate; three separate fights at y8 | 14 m (tunnel 10 m) | Two crossings to the canal |
| 2 — canal | Dry concrete trough and rock galleries at y24; three window bays over the road | 6 m | C12-P (Pier Stair) and C12-S (Sluice Stair), 58 m apart |
| 3 — west bank | Boulders, Hanging Path, mill, ice, spillway chute climb (y8 → 32) | 4 m | None before the dam; one firing glimpse at the roadblock |

The dam complex is the objective convergence: yard, turbine hall, Ops Block,
lower adit, three shafts, the inspection gallery, the 116 m crest and gate house,
both abutment plazas, the knoll, the reservoir road and the motor pool. Content
spans about 284 × 520 m of irregular gorge. Walking from Ford Court to the dam is
242 m by road, 319 m by canal and 330 m by the west bank. The minutes come from
three fights per route and the dam's decisions, not from distance.

## Opposition

There are 33 guards: 8 on the road, 6 on the canal, 7 on the west bank and 12 in
the dam complex. They are riflemen and MGs only; the RPG, sniper and officer IDs
are reserved but not built. Four reserve riflemen and two technicals are placed
and dormant from the start. The worst case is 39 encounter entities, under the
cap of 42, with fixed counts at every budget. The gorge carries sound: a fight on
one route alerts nearby groups on the others, who stay inside their own regions.
The specification maps exactly who hears what (§10.4).

## Campaign state

Carried-in prisoners from the previous campaign-run mission (or the replay pool,
on a replay) are moved to five holding sockets in the Ops Block. Today they would
be placed at coordinates saved from Mission 1's world, which is one of the new
capabilities below. Extraction requires all six free and standing, so no one is
left behind.

The turbine hall's tool crib holds authored loot: a left-handed LR-12L
semi-automatic for Marsh (his only way to get one), an S3 and an MK4-S. Loadouts
carry into Mission 3 as today.

## Engineering and verification

Mission 2 reuses Mission 1's capability cards (U-108–U-113, U-120–U-125) and adds
eight new capabilities:

- **N1** demolition targets and the `demolish` objective;
- **N2** the unarmoured `technical` archetype;
- **N3** holding sockets and rescue-all;
- **N4** height-bounded area sets;
- **N5** parked dormant vehicles;
- **N6** slit balustrades and embrasures, with a controller test;
- **N7** the dam and winter art kit;
- **N8** bot and headless support.

The specification lists 16 geometry checks, a mission matrix covering every route,
split and prisoner case, the commands to run, and 19 capture positions. Its
design checks already pass against the model: 114,912 spawn-screening rays, all
support rays, stair budgets, noise distances and vehicle sweeps. They must be
repeated against the built level. Human review judges feel, fairness and the
30–45-minute target. No verdict is claimed.
