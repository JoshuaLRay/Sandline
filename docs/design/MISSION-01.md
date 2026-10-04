# Mission 1 — The Qalat Road

**Current design: U-107 full replacement, 2026-10-04.** The owner rejected the
rectangular valley as insufficient and requested an authored map with naturally
concealed insertion, a primary road, an overlooking ridge and a giant underground
basement approach, all occupied by enemies. U-106's merged map remains the current
game until this new design is implemented. This documentation does not claim a
new playable level or owner quality approval.

The **[complete map and mission construction specification](maps/qalat-road.md)**
is authoritative for geometry, exact coordinates, room dimensions, enemy sockets,
mission timing, supplies, checkpoints, engine prerequisites and verification.
This brief is its summary. [CAMPAIGN.md](CAMPAIGN.md) owns campaign progression;
[the shared standard](MAP-MISSION-CREATION.md) governs route design.

## Premise and mission flow

Afghanistan, winter 2001–2002. An allied prisoner is held in the records room of
an occupied mountain logistics outpost. The squad approaches through the surface
road, its eastern ridge or the buried storehouses of an older depot, rescues him,
defeats the responding tank and returns to Juniper Hollow with all seven alive.

1. **Insert:** all six start together in a ravine pocket screened from every
   enemy position/route by folded terrain and a natural overhang. Two bends reveal
   the weigh-station court and three clear route entrances.
2. **Approach:** choose the winding supply road, climbing ridge or underground
   depot. Split squads can use the ridge to support the road. The basement has no
   intermediate surface connection. Enemies occupy every route.
3. **Outpost:** enter through south, east or west gate, reach the northwest records
   room and hold the rescue interaction for 3 seconds. Eliminating the radio
   operator in the northeast room is optional and delays armour release.
4. **Return:** shelter and command the POW, choose any of the three routes home,
   destroy the tank and extract all seven at the original insertion pocket.

## Objectives and checkpoints

| Index / stage | Objective | Required | Checkpoint |
|---|---|---|---|
| 0 / approach | Reach the outpost through any ground-floor entrance | Yes | On completion |
| 1 / rescue | Free the prisoner (`rescue`, 3 s, 2 m, same-floor LOS) | Yes | On completion |
| 2 / rescue | Silence the radio operator (`destroy`) | No | None |
| 3 / return | Destroy the tank (`destroy`) | Yes | On completion |
| 4 / return | Reach Juniper Hollow with all six soldiers and POW standing | Yes | Mission ends when both return objectives are complete |

No hold-the-area objective, forced route-clear or kill-every-enemy requirement.
First squad/POW death fails; existing all-downed behaviour remains. All objectives
and interaction distances distinguish floors: underground presence does not
satisfy a surface trigger. Exact volumes and retry state are in specification §10.

## Map identity

| Route | Construction | Connections |
|---|---|---|
| 1 — assault road | Winding 12 m carriageway plus 4 m shoulders; three fight spaces separated by rock spurs; floor y8 | Two named stair passages to ridge |
| 2 — ridge | Continuous 8 m shelf climbing from y8 to y30; three distinct overlooks, return descent and bridge over tank ingress | C12-L/C12-U; joins outpost east gate |
| 3 — underground depot | Buried grain stores, cistern, generator gallery, great vault and service rooms at y0; 4 m passages, large chambers | Only loading entrance and outpost west stair; zero intermediate surface links |

The old 120×200 m rectangle, riverbed flank, terrace slots and three C12 openings
are superseded. New content spans roughly 184 m across and 478 m north-south,
with irregular walkable ribbons and rooms; bounding dimensions are not playable
area. The centreline approach is about 321 m on the road and 356 m on the ridge,
plus the shared insertion and final gate legs. Large basement chambers deliberately
exceed the narrower circulation aisles. See the specification's three diagrams.

## Opposition and return set piece

Thirty-two initial guards: 10 road, 6 ridge, 9 basement, 6 garrison and 1 radio
operator, using existing rifleman/MG archetypes. Four reserve riflemen and one
tank are staged in screened spaces; they are not spawned in sight. Captive POW
is separate. Counts, individual coordinates, patrols and cover regions are fixed
in specification §9. The map remains below the existing encounter cap 42.

The tank activates 5 seconds after rescue if the radio operator is alive then,
otherwise 20 seconds after rescue. It follows an external service road, passes
under the ridge and joins the main approach southbound. It stops at the southern
road throat **outside** the concealed insertion ravine. Destroying it is required
even if the squad returns underground. Reserve infantry release at 45 seconds,
allowing an initial escort-teaching beat. The map supplies finite rocket/medical/
ammo caches; their new runtime support is an explicit prerequisite, not assumed.

## Campaign and verification

Preserve existing run types, prisoner pools, six playable slots plus one unplayable
escorted POW, end-loadout carry-over, replay behaviour and legacy QA mission-01.
Old-map checkpoints need revision-aware restart, not coordinate transplantation.

The map specification lists twelve geometry gates and all nine approach/return
pairings, enemy/trigger/save tests, tank clearance, supplies, rendering budgets,
mobile commands and actual capture positions. Run existing repository CI and
measured combat simulations after implementation; previous 0/20 completion is a
historical limitation, not a success floor. Human review still judges route feel,
fairness, underground readability and the campaign's30–45-minute target.

## Superseded decisions and retained history

The original brief was approved 2026-10-02; U-092–U-095 implemented it, U-097/U-096
added elevation/art, and U-106 implemented the first lane-separation revision.
Those cards retain their evidence. The new owner direction authorizes redesign,
not a claim that those historical acceptance checks prove this new map.

U-107 replaces footprint/layout, flank type, crossing count, guard distribution,
spawn elevation/occlusion, counterattack release timing, tank endpoint and map
checkpoint compatibility. It retains the rescue premise, optional radio's5/20-second
armour timing, mandatory tank destruction, all-seven extraction and carry-over.
The complete numeric design is in the linked construction specification; do not
combine its coordinates with older cards or QA review routes.
