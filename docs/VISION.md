# Sandline — what we are building

**Conflict: Desert Storm, with a squad of six — and gear worth finding.** You
lead, command and switch between six soldiers, keep every one of them alive,
and fight through a linear campaign of objective missions on varied, believable
maps. One to six friends play online in the browser; bots take the empty slots
and play the same game. Along the way the squad finds weapons, attachments and
equipment worth keeping, and builds each soldier around what it finds.
Afghanistan, winter 2001–02, original IP.

This page is the product's north star. [ADR-021](adr/021-conflict-gameplay-reference.md)
makes the Conflict series the default for anything not otherwise decided, and
[ADR-022](adr/022-conflict-reference-scope.md) names the three games that count;
[the parity tracker](design/CONFLICT-PARITY.md) lists, feature by feature, what
the series had and what Sandline has. `PLAN.md` §1 is the original 2026-09 plan
and is out of date where this page differs.

**Approved principle vs undecided implementation.** Everything in the pillars
and anti-goals below is an approved direction. Where a mechanism is still open
(the loot system's details, the awareness indicators' final form, a drivable
vehicle) this page says so and links the planning document or card that holds
the options; it does not decide them.

## The reference

Only three games are active references (owner, 2026-10-16; ADR-022):

1. *Conflict: Desert Storm* (2002) — primary;
2. *Conflict: Desert Storm II – Back to Baghdad* (2003) — primary;
3. *Conflict: Global Storm* (2005, *Global Terror* in North America) —
   **selective**, for improvements such as coordinated squad commands.

*Conflict: Vietnam* and *Denied Ops* are not references.
- **Taken:** mechanics, structure, pacing and feel. **Never taken:** names,
  characters, missions, maps, dialogue, logos, art, audio, UI layouts or level
  geometry (ADR-020 §4). Sandline is its own IP.
- **Beyond the series, by owner decision:** loot-driven equipment progression
  and equipment freedom (P8, ADR-024), richer enemy awareness and stealth,
  capture and rescue, the mobile commander. These are additions, not
  "Conflict defaults".

## Pillars

Every card names the pillar it serves. Work on a core pillar outranks polish on
something the series never had. P8 is an owner pillar beyond the series; its
implementation waits for the loot design session, so until then P1–P7 work and
the Mission 1 build lead the queue.

| # | Pillar | In the series | In Sandline |
|---|---|---|---|
| P1 | **A squad of specialists** | Four soldiers — leader/rifleman, sniper, heavy weapons/tank hunter, demolitions engineer — whose skills make each best at one job; missions need more than one job | Six named characters in two fireteams of three, each starting as a specialist ([roster](design/squad-roster.md)). Specialisation now comes from the equipment the squad finds and assigns, not a locked class (ADR-024); missions still need more than one job |
| P2 | **Command the squad** | Follow, hold, advance to a point (with facing), fire at will / stand down, plus one-press all-squad follow/hold and prone/stand; DS II adds form up and hit the dirt; Global Storm adds ordered charge placement, heal/protect orders and sequenced "advanced orders" | Move, attack, hold, regroup and revive orders; spread; stance; hold fire / defensive / aggressive; marks — to one soldier, a fireteam or everyone. One human with five bots must be able to play every mission: context orders (man a gun, plant and detonate) and reliable orders come before synchronised orders |
| P3 | **Switch into any soldier** | Hot-swap at any time; the soldier you leave keeps his last order under AI | Switch into any bot you command (ADR-001 addendum, U-026); humans occupy their slots |
| P4 | **Grounded third-person combat** | Over-the-shoulder camera, first-person aim and scope zoom, stand/crouch/prone (steadier when still and low), finite ammo, lobbed and smoke grenades, silent knife and suppressed kills, rockets for armour; enemies that are unaware until they see or hear you | Same core with ADS, stances incl. prone (ADR-016), suppression, cover-using enemies, slot keys 1–6. Enemy awareness goes beyond the series: unaware → suspicious → investigating → alerted → combat, with search, alarms and no omniscience ([stealth design](design/STEALTH-AWARENESS.md)) |
| P5 | **Every soldier matters** | One health bar each; medikits heal yourself or a squadmate; a downed soldier bleeds out over about two minutes unless healed; in DS II a death fails the mission | Downed for two minutes (ADR-025), revive and health kits; enemies can capture the downed and the squad rescues them in a later mission (an owner addition); a death fails the mission (U-033); no respawn |
| P6 | **A linear campaign of objective missions** | Briefing with a map → several objectives (POW rescue, demolition, escort, raid, extraction) → debrief; DS II has ten missions; experience, promotions and medals carry between missions; limited saves; three difficulties | A ten-mission season built one mission at a time ([campaign](design/CAMPAIGN.md)) on maps that offer varied approaches rather than one formula (ADR-023); per-objective checkpoints; campaign and replay runs; XP and ranks; carried loadouts |
| P7 | **Period set pieces** | Mounted guns, enemy tanks and APCs, AA guns, drivable jeeps and IFVs, laser-designated air strikes, helicopter extraction | Mounted MGs, an enemy tank the squad must kill (directional armour rewards flanking), demolition objectives; technicals and helicopter extraction come with Mission 2; one drivable multi-crew vehicle is a later epic; air support is a gap |
| P8 | **Find it, keep it, build around it** *(owner addition, 2026-10-16)* | Weapon pickups from the dead and the field; DS1's per-weapon skill stars; no loot | Equipment found during missions and earned by completing and replaying them; any soldier can use any equipment (Marsh's left-handedness aside); persistent rewards make replays worth playing. The mechanics are being designed ([loot planning](design/LOOT-PROGRESSION.md)); grounded tactics stay ahead of gear power |

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
and an overwatch team (ADR-001). The table is each character's **starting**
configuration (ADR-024): what they find later can take them anywhere.

| Series role | Sandline character (slot) | Starts with | Keeps whatever they carry |
|---|---|---|---|
| Leader / rifleman | **Preach** (0), assault fireteam lead | AR, concussion grenades | — |
| Heavy weapons / tank hunter | **Brennan** (1) | LMG and the squad's rocket launcher | — |
| Demolitions engineer (DS1's medic skill) | **Holloway** (2), the support | SMG and shotgun, C4 | 10% faster, 20% faster interactions; third-person, no ADS (its interaction with scoped loot is an open decision, U-194) |
| — (new) | **Ortiz** (3), overwatch fireteam lead | Scoped AR, smoke grenades | — |
| Sniper | **Marsh** (4) | Left-handed bolt-action rifle, claymore | Left-handed: only left-handed-compatible firearms, which loot supplies across categories |
| Sniper | **Vance** (5) | Semi-automatic sniper rifle, motion sensor | — |

Character skills (cooldown abilities) stay deferred by the owner (ADR-001
addendum 2026-09-29) and are not brought back through loot. Characters differ
by identity, starting loadout, speed, interaction time and handedness; what
they become is up to the squad's loot.

## Adapting the series to six players online

1. **Address orders at three levels:** a soldier, a fireteam (0–2 assault,
   3–5 overwatch) or the whole squad. Keep the series' one-press whole-squad
   toggles; never make six soldiers six times the button presses.
2. **Bots do what humans do.** Any slot may be a bot, so every soldier ability
   and interaction (heal, revive, use a cache, plant a charge, man a gun, pick
   up and hand over equipment) needs an order or AI path, not just a player
   prompt. A mission must be fully playable by one human commanding five bots.
3. **No pause and no modal menus that stop play.** The order wheel and menus
   run in real time; six people share one clock.
4. **Encounters scale on human count**, never on squad size (ADR-001).
5. **Respect other players.** Switch only into bots you command; the host makes
   run choices; per-player state (camera, HUD, input) resets on every possession.
6. **Shared stakes.** One death or one lost POW fails the mission for everyone;
   retries return to the last objective checkpoint.
7. **Loot works for one human or six.** Ownership, sharing and persistence must
   be fair with any mix of humans and bots, never duplicate an item, and never
   let one player grief another's gear (the rules are the loot design
   session's, LOOT-PROGRESSION.md §6).

## Deliberate differences

| The series | Sandline | Decided by |
|---|---|---|
| Four soldiers | Six, in two fireteams | ADR-001, ADR-015 |
| Split-screen or LAN co-op for up to four | Online browser co-op for one to six, bots in empty slots, drop-in and drop-out | ADR-001, ADR-011, ADR-012 |
| Switch into anyone | Switch into bots you command | ADR-001 addenda (U-025, U-026) |
| Gulf War 1991 | Afghanistan 2001–02, US infantry vs irregular fighters | ADR-020 |
| Per-weapon skill stars, any soldier uses any gun | Any soldier uses any equipment (Marsh: left-handed only); starting loadouts, not classes; loot-driven progression being designed; XP and ranks; skills deferred | ADR-024, ADR-001 addenda |
| No capture system: an unhealed soldier dies (DS1 replaces him with a rookie; DS II fails the mission) | A death fails the mission, and downed soldiers can be captured and rescued in the next campaign mission | U-033, U-032, U-061–U-064 |
| Two manual saves per mission | Automatic checkpoint per completed objective; restart menu | CAMPAIGN.md D7, U-059, U-078 |
| Compact linear levels | Larger maps with varied, meaningful approaches and believable terrain; three approaches is a starting point, not a rule (Qalat and Kestrel keep their approved three routes) | ADR-023, MAP-MISSION-CREATION.md |
| Basic sight-and-alarm enemies | Graded awareness (unaware → combat), search, alarms; temporary overhead indicators while voices are unavailable | STEALTH-AWARENESS.md |
| No loot | Loot-driven equipment progression | ADR-024, LOOT-PROGRESSION.md |
| Single-player PC/console | Plus a mobile spectator-commander mode | ADR-002, mobile design |
| PvP modes on PC | No PvP; no destructible terrain; no voice chat | ADR-002 |

## Anti-goals

- **Not a milsim.** No ballistic, medical or logistics simulation beyond what
  makes squad decisions matter. Thirty-to-forty-five-minute missions, not hours.
- **Not a power fantasy.** Loot makes players excited to find and build, but it
  never makes positioning, cover, suppression or the squad irrelevant: no gear
  score that out-ranks tactics, no runaway stat inflation, no character perk
  trees or cooldown abilities. Still no killstreaks, regenerating health,
  battle passes or cinematic on-rails sequences. (Rarity, named items and
  similar are open loot-design questions, not anti-goals.)
- **Not a loot treadmill that ignores the mission.** Rewards come from playing
  missions well; they must not teach players to skip objectives to farm.
- **Not breadth before depth.** One mission that plays like Conflict beats three
  that don't. Finish a pillar before adding variety.
- **Not a copy.** If something is recognisably a specific Conflict asset, line
  or level, it is wrong even if it plays right.

## What v1 is

A first season of ten 30–45 minute missions (CAMPAIGN.md D2), playable from one
to six humans, meeting P1–P6 fully, P7 to the extent each mission's design
needs, and P8 to the scope the loot design session approves. Mission 1 (The
Qalat Road) is being rebuilt to its approved specification; Mission 2 (The
Kestrel Dam) is designed; missions 3–10 are not. The parity tracker orders the
remaining Conflict systems work; the loot epic (U-183) orders P8.
