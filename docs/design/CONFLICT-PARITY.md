# Conflict parity tracker

What the Conflict series did, what Sandline does, and what is missing — the
backlog's source of "what to build next" once queued work runs out, and the
reference an agent uses under [ADR-021](../adr/021-conflict-gameplay-reference.md).
Pillars P1–P8 are defined in [VISION.md](../VISION.md).

**Keep it current.** When a card changes a row's status, update the row in the
same PR. Gaps are proposals: a gap becomes work only when the owner queues it
(“Queue the next Conflict parity gap”) and the report-feedback skill turns it
into a card. A row marked *owner* needs a decision before it can be scoped.

Status: ✅ built · 🟡 partial · ❌ gap · ⏸ deferred by the owner · ⛔ different by decision.
Series column ([ADR-022](../adr/022-conflict-reference-scope.md)): DS = *Desert
Storm* (2002) and DS II = *Desert Storm II* (2003), the primary references;
GS = *Global Storm* (2005), used selectively (chiefly squad command). *Conflict:
Vietnam* and *Denied Ops* are not references. Facts come from the DS1 manual and
contemporary reviews (sources at the end); *unverified* marks anything the
research could not confirm.

Rows marked "owner addition" are Sandline directions beyond the series
(loot and equipment progression, ADR-024; graded enemy awareness,
[STEALTH-AWARENESS.md](STEALTH-AWARENESS.md)); they are tracked here so the
queue sees them, not because the series had them.

## Matrix

### P1 — A squad of specialists

| ID | Feature | Series | Sandline | Status |
|---|---|---|---|---|
| CP-01 | Distinct specialist roles | Leader, sniper, heavy weapons, demolitions | Six characters (U-019, U-021) who **start** as specialists; any soldier can become another role through equipment (ADR-024) | ✅ adapted |
| CP-02 | Role equipment | C4 and mines (engineer), LAW (heavy), scoped rifles (sniper) | Slot-5 starting equipment per character (U-048, U-054–U-058); any soldier may carry any equipment once the restrictions are reconciled (U-194) | ✅ |
| CP-03 | Skill grows with use | Per-weapon skill stars 0–4; experience raises health, accuracy, reactions | XP and ranks only; weapon proficiency is a loot-session question (LOOT-PROGRESSION L-26) | ⏸ skills deferred (U-023) |
| CP-04 | Give items to a squadmate | Face him and "Give" weapons or ammo | Drop and pick up (U-029); give ammo with finite reserves (U-199); bots hand off on order (U-200) | 🟡 queued |
| CP-05 | Field and enemy weapon pickups | Yes | U-017, U-018; loot-driven acquisition is the loot epic (U-183) | ✅ |

### P2 — Command the squad

| ID | Feature | Series | Sandline | Status |
|---|---|---|---|---|
| CP-06 | Follow, hold, move to a point | Yes, per soldier or all | Regroup, hold, move; per soldier, fireteam or all | ✅ |
| CP-07 | Move order sets facing | Place marker, then set facing | Move and hold take the facing the player looks along; the marker shows it (U-154) | ✅ adapted |
| CP-08 | Fire discipline | Fire at will / stand down | Hold fire / defensive / aggressive (U-101) | ✅ |
| CP-09 | One-press whole-squad toggles | Follow↔hold, prone↔stand; DS II "hit the dirt", "form up" | One wheel flick to all: hold, regroup, Auto/Crouch/Prone (U-153) | ✅ adapted |
| CP-10 | Attack a target, marks | Not in DS1 orders | Attack order and marks (T-3.27) | ✅ beyond the series |
| CP-11 | Context orders (revive, heal, use, man a gun, plant a charge) | DS/DS II: the player performs these via prompts; GS: orders to plant C4 at a point and to heal or protect a squadmate | Revive order; bots heal on their own (U-053); commanded cache use (U-146, U-147); man a gun (U-197); plant and detonate (U-198, after U-182's two detonators) | 🟡 queued |
| CP-12 | Bounding, covering and focus fire | Not in the series (reviewers asked for better AI) | U-087 deferred; friendly suppressive fire on attack orders needs an owner go-ahead (U-201); T-5.06 open | ⏸ |

### P3 — Switch into any soldier

| ID | Feature | Series | Sandline | Status |
|---|---|---|---|---|
| CP-13 | Hot-swap | Any soldier, any time | Any bot you command (U-026) | ✅ adapted |
| CP-14 | The soldier you leave keeps his order | Yes | Becomes a bot under your command and follows; bots' orders survive switches and leaves, untested (audit 2026-10-16) — U-196 | 🟡 queued |
| CP-48 | Synchronised "advanced orders" | GS: a sequence of orders per soldier, released together on a signal | None; after command reliability (U-196–U-198) — U-202 | ❌ queued |

### P4 — Grounded third-person combat

| ID | Feature | Series | Sandline | Status |
|---|---|---|---|---|
| CP-15 | Third person, first-person aim and scope zoom | Yes | Yes; support is third-person only by design | ✅ |
| CP-16 | Stand, crouch, prone; steadier when still and low | Yes | Yes (ADR-016, `proneSpreadScale`) | ✅ |
| CP-17 | Finite ammo, reload | Yes | Server-authoritative magazines (U-028), but **reloads are unlimited**: there is no reserve ammunition (audit 2026-10-16; corrects an earlier ✅) — U-199 | 🟡 queued |
| CP-18 | Frag and smoke grenades, lobbing | Yes; DS II adds incendiary, flare gun, claymore | Frag, smoke, concussion, claymore, C4, cooking; C4 right click sets off the oldest charge, R all (U-182) | ✅ |
| CP-19 | Silent kills and stealth openings | Knife and suppressed weapons on sentries | Knife exists; no suppressed weapons; no unaware/alarm state. Epic U-204: five awareness states (U-205), noise (U-206), search (U-207), alarms (U-208), indicators (U-209), suppressors (U-210), takedowns (U-211) | ❌ queued |
| CP-20 | Rockets for armour, weak rear | Tanks best hit in the rear | Rockets and C4 kill the tank; armour is by damage type, not direction — U-213 | 🟡 queued |
| CP-21 | Binoculars, spotting | Leader carries binoculars (*unverified* loadout); GS adds thermal vision | Marks and the motion sensor; no binoculars — U-220 (as an item, after the item foundations) | ❌ queued |
| CP-22 | Mounted guns | "Mount Gun" prompt | Mounted MGs for both sides (U-034) | ✅ |

### P5 — Every soldier matters

| ID | Feature | Series | Sandline | Status |
|---|---|---|---|---|
| CP-23 | Medikits heal self and squadmates | Yes, plentiful | Health kits (U-047); bots use them (U-053) | ✅ |
| CP-24 | Downed, bleed-out, revive | About 2 minutes to heal a badly wounded soldier | Bleed-out 120 s, revive 3 s (`damage.json`, ADR-025, U-181) | ✅ |
| CP-25 | A death fails the mission | DS II; DS1 replaces him with a rookie | U-033 | ✅ |
| CP-26 | Capture and rescue | Story only, not a system | U-061–U-064 | ⛔ owner addition |

### P6 — A linear campaign of objective missions

| ID | Feature | Series | Sandline | Status |
|---|---|---|---|---|
| CP-27 | Linear campaign, replay | DS II has ten missions | Season of ten; campaign and replay runs (U-072, U-088–U-090) | ✅ structure |
| CP-28 | The missions themselves | ~10–15 per game | Mission 1 being rebuilt (U-108–U-119), Mission 2 designed, 3–10 undesigned | 🟡 |
| CP-29 | Objective variety | POW rescue, VIP escort, raids, SCUD hunts, demolition, extraction | reach, destroy, defend, survive, upload, rescue, escort | ✅ |
| CP-30 | Briefing with a map; objectives and map in mission | Briefing movie, text and map; F1 objectives and local map | Text briefing and debrief (U-088); HUD objective; no map | 🟡 |
| CP-31 | Saves | Two manual saves per mission | A checkpoint per objective; restart menu (U-059, U-078) | ⛔ improved |
| CP-32 | Difficulty settings | Easy, medium, hard | Director budget by human count only (CAMPAIGN D8) | ❌ *owner* |
| CP-33 | Progression and rewards | Experience, promotions, medals | XP and five ranks; no medals; loot-driven progression is the loot epic (U-183) | 🟡 |
| CP-34 | Carry-over between missions | *unverified* | Weapons, ammo and gear carry (U-077) | ✅ |
| CP-49 | Loot and equipment progression | None (pickups and carry-over only) | Owner addition (ADR-024): planning package [LOOT-PROGRESSION.md](LOOT-PROGRESSION.md), design session U-184, epic U-183 | ⛔ owner addition, queued |

### P7 — Period set pieces

| ID | Feature | Series | Sandline | Status |
|---|---|---|---|---|
| CP-35 | Enemy armour | Tanks and BMPs | Tank (U-066–U-070, U-126); bots fight it (U-079); hit feedback, damage stages and audio missing (U-214); APC (U-217) | 🟡 no APC |
| CP-36 | Enemy light vehicles | Jeeps and trucks | None; Mission 2 needs technicals and parked vehicles (kestrel-dam.md N2, N5) — U-215 | ❌ queued |
| CP-37 | Drivable vehicles | Humvee, Bradley (DS1); Land Rover DPV (DS II); one drives, others shoot | None (cut from the slice by ADR-015); one multi-crew vehicle is a future epic needing an owner go-ahead and an ADR — U-218 | ❌ *owner* |
| CP-38 | Air strikes | Laser designator, lock, call (GS: designator for gunship strikes) | None | ❌ *owner* |
| CP-39 | Helicopter extraction | Flares mark the landing zone | None; Mission 2's design ends with one, offscreen (OD-1) — U-216 | ❌ queued |
| CP-40 | AA guns as demolition targets | ZU-23s (DS II) | `destroy` today means "a group is dead"; Mission 2 needs a `demolish` objective with charge points (kestrel-dam.md N1) | 🟡 |

### Enemies, HUD, audio and co-op

| ID | Feature | Series | Sandline | Status |
|---|---|---|---|---|
| CP-41 | Enemy archetypes | Riflemen, PKM gunners, RPG troops; snipers and officers *unverified* | Rifleman, MG, RPG gunner (U-155: fights U-157, drawn U-158; look batched in U-119); `sniper`, `officer` reserved, not built | 🟡 |
| CP-42 | Alarm and reinforcement | Being seen raises a base alarm; everyone comes | Sight, sound and memory perception; staged reserves (U-131); no alarm state — U-208 (warnings, alarms, reserve release), in epic U-204 | 🟡 queued |
| CP-43 | Enemies use cover, suppress and flank | Weak in the series | Yes (T-3.20–T-3.23, U-086) | ✅ better |
| CP-44 | Per-soldier HUD panels | Health, order, fire-at-will, controlled soldier, radio flash | Six squad rows with state and current order | ✅ |
| CP-45 | Compass, objective pointer, radar | Compass with objective arrow; radar blips | Compass strip with markers; no radar | 🟡 |
| CP-46 | Squad radio chatter | Acknowledgements and callouts | Cue routing built (U-012); no recordings (U-013, ADR-017); temporary overhead awareness glyphs carry enemy state meanwhile (U-209) | 🟡 *owner* (recordings) |
| CP-47 | Co-op | Up to four, split screen (Xbox) | One to six online, drop-in, bots fill | ✅ adapted |

## Recommended gap order

Ordered by pillar weight, then by value for cost. Sizes are rough (S/M/L as in
the card template). The owner queues them; queued gaps are interleaved with the
Mission 1 build (owner direction, 2026-10-09) and marked **Queued** below.

| # | Gap | Rows | Size | Why now |
|---|---|---|---|---|
| G-1 | Whole-squad stance order ("hit the dirt"), form-up, and facing on move orders | CP-07, CP-09 | S | Done: stance (U-153), facing (U-154) |
| G-2 | RPG enemy archetype | CP-41 | M | **U-155 DONE (U-157, U-158); placement in Mission 1 is U-117, look batched in U-119** |
| G-3 | Alarm state, unaware sentries, suppressed weapons | CP-19, CP-42 | L (epic) | **Queued 2026-10-16** as epic U-204 (U-205–U-212); owner asked for graded awareness beyond the series |
| G-4 | Order a soldier to man a gun or plant/detonate a charge | CP-11 | M | **Queued:** U-197 (man a gun), U-198 (plant/detonate, decision) |
| G-5 | Ammo transfer between soldiers | CP-04, CP-17 | M | **Queued:** U-199 (finite reserves + give; needs the loot session's carry decision) |
| G-6 | Technicals and helicopter extraction | CP-36, CP-39 | M each | **Queued:** U-215, U-216 (Mission 2 capabilities; build waits on OD-8) |
| G-7 | Directional tank armour (weak rear) | CP-20 | S | **Queued:** U-213; feedback and audio U-214 |
| G-8 | Binoculars | CP-21 | S | **Queued:** U-220 (after the item foundations) |
| G-9 | Map screen and briefing map | CP-30 | M | Larger maps with varied approaches need one more than the series did |
| G-10 | Difficulty settings | CP-32 | S | *Owner:* D8 chose director budget only, "may change later" |
| G-11 | Drivable vehicle (jeep with a gunner) | CP-37 | L, new ADR | *Owner:* reopens ADR-015's cut; future epic U-218 |
| G-14 | Bots keep their orders through switches and leaves | CP-14 | S | **Queued:** U-196 (reliability before new orders) |
| G-15 | Synchronised "advanced orders" (GS) | CP-48 | M | **Queued:** U-202, after U-196–U-198 |
| G-12 | Laser-designated air strike | CP-38 | M | *Owner:* scope and balance |
| G-13 | Medals and mission ratings | CP-33 | S | Low weight |
| — | Character skills, squad radio voices | CP-03, CP-46 | — | Blocked: owner deferred skills; voices need recordings (ADR-017) |

## Sources

DS1 official PC manual (Steam CDN, app 211780) and Xbox manual (archive.org);
GameSpot reviews of DS1, DS II, Vietnam and Global Terror; HonestGamers and
Gamecritics on DS II; VideoGamer on Global Storm; Co-Optimus co-op listings;
IMFDB and Wikipedia for loadouts. Research run 2026-10-09; page fetches were
proxied through search extraction, so treat single-source facts as provisional.
The Vietnam review is historical research only (ADR-022).

Global Storm command research, 2026-10-16 (secondary sources, *unverified*):
Gameswelt's review (reworked order interface; ordering C4 placed at a point;
ordering squadmates to heal or protect one another), product and fan
descriptions of sequenced "advanced orders" released on a signal, GameSpot's
launch coverage ("refined order system"), Wikipedia's *Conflict: Global
Terror* page and IMFDB (suppressed pistols; thermal vision and a laser
designator in fan descriptions).
