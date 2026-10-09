# Sandline — what we are building

**Conflict: Desert Storm, with a squad of six.** You lead, command and switch
between six specialist soldiers, keep every one of them alive, and fight through
a linear campaign of objective missions. One to six friends play online in the
browser; bots take the empty slots and play the same game. Afghanistan, winter
2001–02, original IP.

This page is the product's north star. [ADR-021](adr/021-conflict-gameplay-reference.md)
makes the Conflict series the default for anything not otherwise decided;
[the parity tracker](design/CONFLICT-PARITY.md) lists, feature by feature, what
the series had and what Sandline has. `PLAN.md` §1 is the original 2026-09 plan
and is out of date where this page differs.

## The reference

- **Primary:** *Conflict: Desert Storm* (2002) and *Desert Storm II – Back to
  Baghdad* (2003) by Pivotal Games.
- **Secondary**, only where those are silent: *Conflict: Vietnam* (2004),
  *Conflict: Global Storm* (2005).
- **Taken:** mechanics, structure, pacing and feel. **Never taken:** names,
  characters, missions, dialogue, logos, art, audio, UI layouts or level
  geometry (ADR-020 §4).

## Pillars

Every card names the pillar it serves. Work on a core pillar outranks polish on
something the series never had.

| # | Pillar | In the series | In Sandline |
|---|---|---|---|
| P1 | **A squad of specialists** | Four soldiers — leader/rifleman, sniper, heavy weapons/tank hunter, demolitions engineer — whose skills make each best at one job; missions need more than one job | Six named characters, distinct by loadout, equipment and rules ([roster](design/squad-roster.md)); two fireteams of three |
| P2 | **Command the squad** | Follow, hold, advance to a point (with facing), fire at will / stand down, plus one-press all-squad follow/hold and prone/stand; DS II adds form up and hit the dirt | Move, attack, hold, regroup and revive orders; spread; hold fire / defensive / aggressive; marks — to one soldier, a fireteam or everyone |
| P3 | **Switch into any soldier** | Hot-swap at any time; the soldier you leave keeps his last order under AI | Switch into any bot you command (ADR-001 addendum, U-026); humans occupy their slots |
| P4 | **Grounded third-person combat** | Over-the-shoulder camera, first-person aim and scope zoom, stand/crouch/prone (steadier when still and low), finite ammo, lobbed and smoke grenades, silent knife and suppressed kills, rockets for armour | Same core with ADS, stances incl. prone (ADR-016), suppression, cover-using enemies, slot keys 1–6 |
| P5 | **Every soldier matters** | One health bar each; medikits heal yourself or a squadmate; a downed soldier bleeds out over about two minutes unless healed; in DS II a death fails the mission | Downed, bleed-out, revive and health kits; a squad death fails the mission (U-033); captured soldiers are rescued in a later mission (an owner addition, not from the series) |
| P6 | **A linear campaign of objective missions** | Briefing with a map → several objectives (POW rescue, demolition, escort, raid, extraction) → debrief; DS II has ten missions; experience, promotions and medals carry between missions; limited saves; three difficulties | A ten-mission season built one mission at a time ([campaign](design/CAMPAIGN.md)); per-objective checkpoints; campaign and replay runs; XP and ranks; carried loadouts |
| P7 | **Period set pieces** | Mounted guns, enemy tanks and APCs, AA guns, drivable jeeps and IFVs, laser-designated air strikes, helicopter extraction | Mounted MGs, an enemy tank the squad must kill, demolition objectives; vehicles, air support and helicopters are gaps |

**Where the series was weak, be better, not faithful.** Reviews of every entry
criticised clumsy aim and auto-aim, scrolling the inventory for a medikit under
fire, only two saves per mission, enemies spotting a prone soldier instantly,
and squadmates who ignore cover and get themselves killed. Sandline keeps the
intent (tension, scarcity, a squad that needs you) and fixes the failure: direct
item keys, objective checkpoints, readable perception, and bots that fight from
cover — bots are on the critical path (ADR-001).

## Six for four

The series' four specialists all exist; the two extra slots give the squad a
second fireteam leader and a second sniper, so it splits into an assault team
and an overwatch team (ADR-001).

| Series role | Sandline character (slot) | What makes them that role |
|---|---|---|
| Leader / rifleman | **Preach** (0), assault fireteam lead | AR, may carry a second AR/SMG/shotgun, concussion grenades |
| Heavy weapons / tank hunter | **Brennan** (1) | LMG and the squad's rocket launcher |
| Demolitions engineer (DS1's medic skill) | **Holloway** (2), the support | SMG and shotgun, C4, 10% faster, 20% faster interactions; third-person only, no ADS |
| — (new) | **Ortiz** (3), overwatch fireteam lead | Scoped AR, smoke grenades |
| Sniper | **Marsh** (4) | Left-handed bolt-action rifle, claymore; left-handed guns only |
| Sniper | **Vance** (5) | Semi-automatic sniper rifle, motion sensor |

Character skills are deferred by the owner (ADR-001 addendum 2026-09-29); the
characters differ by role, loadout, equipment, speed and handedness.

## Adapting the series to six players online

1. **Address orders at three levels:** a soldier, a fireteam (0–2 assault,
   3–5 overwatch) or the whole squad. Keep the series' one-press whole-squad
   toggles; never make six soldiers six times the button presses.
2. **Bots do what humans do.** Any slot may be a bot, so every soldier ability
   and interaction (heal, revive, use a cache, plant a charge, man a gun) needs
   an order or AI path, not just a player prompt.
3. **No pause and no modal menus that stop play.** The order wheel and menus
   run in real time; six people share one clock.
4. **Encounters scale on human count**, never on squad size (ADR-001).
5. **Respect other players.** Switch only into bots you command; the host makes
   run choices; per-player state (camera, HUD, input) resets on every possession.
6. **Shared stakes.** One death or one lost POW fails the mission for everyone;
   retries return to the last objective checkpoint.

## Deliberate differences

| The series | Sandline | Decided by |
|---|---|---|
| Four soldiers | Six, in two fireteams | ADR-001, ADR-015 |
| Split-screen or LAN co-op for up to four | Online browser co-op for one to six, bots in empty slots, drop-in and drop-out | ADR-001, ADR-011, ADR-012 |
| Switch into anyone | Switch into bots you command | ADR-001 addenda (U-025, U-026) |
| Gulf War 1991 | Afghanistan 2001–02, US infantry vs irregular fighters | ADR-020 |
| Per-weapon skill stars, any soldier uses any gun | Fixed character loadouts and exchange rules; XP and ranks; skills deferred | ADR-001 addenda, U-019, U-022, U-029 |
| No capture system: an unhealed soldier dies (DS1 replaces him with a rookie; DS II fails the mission) | A death fails the mission, and downed soldiers can be captured and rescued in the next campaign mission | U-033, U-032, U-061–U-064 |
| Two manual saves per mission | Automatic checkpoint per completed objective; restart menu | CAMPAIGN.md D7, U-059, U-078 |
| Compact linear levels | Large maps with three physically distinct routes | MAP-MISSION-CREATION.md (owner, 2026-10-04) |
| Single-player PC/console | Plus a mobile spectator-commander mode | ADR-002, mobile design |
| PvP modes on PC | No PvP; no destructible terrain; no voice chat | ADR-002 |

## Anti-goals

- **Not a milsim.** No ballistic, medical or logistics simulation beyond what
  makes squad decisions matter. Thirty-to-forty-five-minute missions, not hours.
- **Not a modern shooter.** No killstreaks, regenerating health, loot rarity,
  perks, battle passes or cinematic on-rails sequences.
- **Not breadth before depth.** One mission that plays like Conflict beats three
  that don't. Finish a pillar before adding variety.
- **Not a copy.** If something is recognisably a specific Conflict asset, line
  or level, it is wrong even if it plays right.

## What v1 is

A first season of ten 30–45 minute missions (CAMPAIGN.md D2), playable from one
to six humans, meeting P1–P6 fully and P7 to the extent each mission's design
needs. Mission 1 (The Qalat Road) is being rebuilt to its approved
specification; Mission 2 (The Kestrel Dam) is designed; missions 3–10 are not.
The parity tracker orders the remaining systems work.
