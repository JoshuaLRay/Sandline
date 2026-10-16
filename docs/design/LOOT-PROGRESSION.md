# Loot, equipment freedom and progression — planning package

**Status: planning document for the owner's loot design session ([U-184](../backlog/U-184.md)).**
Only the principles in [ADR-024](../adr/024-equipment-freedom-and-loot.md) are
approved: loot-driven progression is a pillar (P8), starting loadouts are not
classes, any character may use any equipment except that Marsh uses only
left-handed-compatible firearms, and grounded tactics stay ahead of gear power.
**Everything else here is an option, a comparison or a recommended starting
assumption.** Nothing below is to be implemented until the session approves it
and [U-185](../backlog/U-185.md) writes the approved specification. Epic:
[U-183](../backlog/U-183.md).

How to read it: §1–§3 set goals and today's facts; §4 compares four whole-system
models; §5–§13 work through each subsystem (the owner's areas A–I) with options,
trade-offs and a recommended default; §14 audits today's restrictions; §15 lists
every open decision (L-01…) with its default so the owner can answer "agree";
§16 is the proposed session agenda; §17 maps decisions to implementation phases.

## 1. Design objectives

1. **Finding something is exciting** — a rare rifle in an officer's quarters, a
   suppressor in a hidden cache, a named weapon only one mission yields.
2. **Freedom to build** — any soldier can become what the squad's finds allow;
   Brennan can become the squad's sniper, Marsh a left-handed machine gunner.
3. **Grounded tactics first** — a better gun makes a good position better; it
   never makes position, cover, suppression or teamwork optional.
4. **Loot rewards playing the mission well** — objectives, reconnaissance,
   stealth and rescues pay, so farming never beats playing.
5. **Fair for one to six humans** — the same rules with one human and five bots
   or six humans; no loot theft, no griefing, no duplication.
6. **Worth replaying** — persistent rewards and mission-specific items give
   replay runs (CAMPAIGN.md D3, D6) a purpose.
7. **Buildable by agents** — data-driven, server-authoritative, deterministic,
   testable; small reversible phases.

## 2. Where Sandline is today (verified 2026-10-16)

| Area | Today | Source |
|---|---|---|
| Carried items | Primary, optional secondary (Preach and Holloway only), implicit pistol, knife; pouch of frag + one equipment item (slot 5); health kits (slot 6) | `Session.ts` `Slot`, `classes.json`, U-022, U-048 |
| Weapons | 11 rows: carbine, marksman, breacher, sidearm, knife, lmg, smg, carbine-scoped, sniper-semi, sniper-bolt-left, sniper-semi-left; each `handedness: right | left` | `weapons.json` |
| Optics | Separate weapon ids (`carbine-scoped`), not attachments | `weapons.json` `scopeFovDeg` |
| Ammunition | One magazine per gun; **reloads are unlimited** (no reserve); caches top up the magazine in hand | `weapons.ts` `finishReload`, `supplyCaches.ts` |
| Pickups | E picks up/swaps, G drops; enemy drops (carbine/marksman/breacher table, in practice carbines) despawn after 120 s, cap 24; authored loot never despawns; ground items saved in checkpoints | U-017, U-018, U-029, `pickups.json` |
| Authored loot | `pickup` script action places firearms (Marsh's `sniper-semi-left` in mission-01) | `events.ts`, `scripts/mission-01.json` |
| Exchanges | No direct hand-over; drop then pick up. Bots never pick up or drop | `Session.ts` |
| Carry-over | Loadout written to the campaign soldier on a mission win; a replay keeps it only with `replayKeepsLoadout` | U-077, `CampaignDatabase.ts` |
| Persistence | Host-owned campaign: missions done, checkpoint, six soldiers `{slot, classId, rank, xp, captured, prisoner, loadout}`; nothing follows a person between campaigns | ADR-019 |
| Identity | Saves use weapon string ids but **numeric indices** for ground weapons and equipment; the wire uses `WEAPON_IDS` indices (4 bits) and a 5-bit pickup item | `checkpointWorld.ts`, `pickups.ts` |
| Progression | XP and five ranks per campaign soldier; no medals; skills deferred | U-024, `progression.json` |

## 3. Lessons from the inspirations

The owner named Borderlands, RuneScape and Destiny. None is copied; each
contributes lessons. (Facts are from common knowledge of the games; they are
design reference, not specification.)

### Borderlands — the loot fountain

- **What it does:** guns are assembled from parts by manufacturer; rarity tiers
  are colour-coded; enemies and chests shower items; bosses have favoured
  legendary drops players farm; later games made co-op loot instanced to stop
  "loot ninjas".
- **What works:** constant novelty; a manufacturer gives a gun a personality
  (fires like *this*), not just a bigger number; the "what did that drop?" beat.
- **What fails for Sandline:** item-level scaling makes yesterday's find
  worthless; inventory clutter and vendor trash; reading stat cards mid-fight;
  cartoon excess fights a grounded tone; shared loot invites theft.
- **Take:** identity through **traits and handling**, not level-scaled damage;
  boss-style **signature drops** tied to specific targets; the instanced-loot
  lesson for co-op fairness.

### RuneScape — fixed items and long goals

- **What it does:** items have fixed, known stats and clear tiers; rare drops
  come from known sources at published-feeling odds; a collection log records
  every unique a player has found; storage (the bank) is large but finite;
  some items degrade; trade and an exchange economy exist; "ironman" modes ban
  trading for self-sufficiency.
- **What works:** an item *means* something because it is always the same;
  long-term goals (complete the log, get the boss unique) drive replay without
  power creep; knowing where an item comes from makes farming a choice.
- **What fails for Sandline:** an economy and trading are heavy to build and
  police; very low drop rates feel bad in a 30–45 minute mission; degradation
  is a chore.
- **Take:** **fixed, knowable item identities**; a **collection log** of
  uniques per mission; known sources; "ironman-like" self-sufficiency fits a
  campaign-owned squad (ADR-019).

### Destiny — rolls, exotics and the grind

- **What it does:** rarity tiers (common to exotic); legendary weapons roll
  perks from per-weapon columns ("god rolls"); exotics have unique,
  build-defining traits and only one may be equipped at a time; a power level
  (gear score) gates content; activity-specific loot pools (a raid's weapons);
  weekly caps and pity systems; crafting from collected patterns reduces bad
  luck; storage (the vault) is limited; old gear was once "sunset".
- **What works:** an **exotic one-per-soldier limit** makes a unique item
  shape a build without stacking; activity-specific pools make each mission's
  loot recognisable; deterministic progress (patterns, pity) keeps bad luck
  from ending motivation.
- **What fails for Sandline:** a gear score that out-ranks skill; rolls that
  turn every drop into a spreadsheet; sunsetting destroys trust; vault limits
  without good sorting are a chore.
- **Take:** **one named item per soldier**; **mission-specific pools**;
  **bad-luck protection**; **no gear score**; never invalidate owned items.

### The Conflict games themselves

Desert Storm let any soldier use any gun he picked up, gave per-weapon skill
stars that grew with use, and carried experience between missions; there was
no loot. Global Storm added a wider equipment set (thermal vision, a laser
designator for air strikes, suppressed pistols, claymores for ambushes) —
reference for *what* military equipment feels right, not for loot structure.

## 4. Four whole-system models

| | A. **Field kit** (curated catalogue) | B. **Variants** (bounded rolls) | C. **Workshop** (attachments first) | D. **Procedural arsenal** |
|---|---|---|---|---|
| Idea | Every item hand-authored with fixed stats; rarity = scarcity and identity | Base weapons plus fixed named variants and 1–2 rolled traits in tight bands | Base weapons are common; attachments (optics, suppressors, magazines, barrels…) and a few named weapons are the loot | Weapons generated from parts with rolled stats and rarity |
| Feels like | RuneScape, Conflict | Destiny-lite | Global Storm + modern tactical shooters | Borderlands |
| Grounded tone | High | Medium–high | High | Low |
| Novelty per drop | Low–medium | Medium–high | Medium | Very high |
| Replay pull | Collection log, signature items | Hunting rolls | Completing kits, rare attachments | Endless |
| Balance risk | Low | Medium | Low–medium (compatibility, stacking) | High |
| Engineering cost | Low | Medium (seeded rolls, versioning) | Medium (attachment model, UI) | High |
| Inventory clutter | Low | Medium–high | Medium | High |
| Marsh's left-handed loot | Author LH variants per category | LH as a variant axis | LH base weapons; attachments shared | LH as a part |
| Bots can use it | Easy | Easy | Easy (attachments are stats) | Easy |
| Fits 30–45 min missions | Yes | Yes | Yes | Drops must be throttled |

**Recommended starting assumption: A + C, with a small B option later.** A
curated catalogue of base weapons (including left-handed variants across
categories) and equipment; **attachments as the steady stream of finds**; a
handful of **named items** per mission with one defining trait each (limit one
named item per soldier). Item quality is bounded and readable; there is no
gear score. If the session wants more novelty, add B's bounded traits to named
or "modified" items only.

## 5. A — Loot acquisition

| Source | Today | Grounded? | Rewards the mission? | Notes |
|---|---|---|---|---|
| Enemy drops | Their own weapons, despawning | Yes | Weakly | Keep as the ordinary stream: what a fighter carries |
| Authored world loot | Script `pickup` | Yes | Yes | Armouries, officers' quarters, vehicles |
| Randomised containers | None | If placed believably | Partly | Crates with a per-mission table |
| Hidden caches | None | Yes | Strongly (recon, exploration) | Authored sockets, contents and/or location varied per run |
| High-value targets | `officer`/`sniper` archetypes reserved | Yes | Strongly | An officer, a weapons dealer, a sniper carrying a signature item |
| Objective rewards | None | Yes | Strongly | Completing an objective (or a bonus objective) grants an item |
| Mission completion | Carry-over only | Yes | Yes | A reward choice or crate at the debrief |
| Replay rewards | `replayKeepsLoadout` | Yes | Yes | First-clear vs repeat tables (§11) |
| Bonus conditions | None | Yes | Yes | No alarm raised, nobody captured, all prisoners rescued |

Options for how chance works: **guaranteed** (every source always yields its
item), **chance** (rolls on a table), or **guaranteed plus chance** (a
guaranteed baseline with a chance at something better), with **bad-luck
protection** (each miss raises the next chance, or a token after N runs).

**Keeping loot from beating objectives:**
- the best items come from objectives, high-value targets, hidden caches found
  by reconnaissance, and completion bonuses — not from clearing every enemy;
- persistent rewards are **banked only on success**: items found in a mission
  are usable at once but become the squad's for keeps only when the mission is
  won (this is how carry-over already works, D6), so dying to grab a crate
  gains nothing;
- enemy drops stay ordinary (their own weapons).

**Recommended default:** enemy drops (ordinary), authored world loot and hidden
caches (better), high-value targets and objectives (best), a completion reward
at the debrief; guaranteed baseline plus chance, with bad-luck protection;
banked on success.

## 6. B — Rarity and item quality

| Option | Shape | For | Against |
|---|---|---|---|
| B1 No tiers | Scarcity and identity only | Most grounded; nothing to read | Less "what did I get?" excitement |
| B2 Three tiers | **Standard · Modified · Named** | Military-plausible words; easy to read; little inflation | Fewer steps of excitement |
| B3 Five tiers | Common → Legendary/Exotic, colour-coded | Familiar; many steps | Reads as a modern looter; colour dependence; inflation pressure |

Attributes: **fixed** (A), **bounded rolls** (B, e.g. ±10 % within a weapon's
family), or **fixed with rolled cosmetic wear**. Named/unique items carry one
defining trait (for example faster reload from the prone position, a quieter
report, a tighter first shot, a larger magazine with heavier handling) and are
limited to one equipped per soldier. Item "quality" as condition (wear that
needs repair) is possible but is a chore in a 30–45 minute mission.

**Avoiding inflation and clutter:** tiers change *how* a weapon behaves, not
its raw damage beyond a small band; duplicates convert automatically (§8);
no item level; nothing ever becomes obsolete by number alone.

**Recommended default:** B2 (Standard, Modified, Named) shown by icon and word
as well as colour (accessible); fixed attributes for Standard and Named,
optional bounded traits for Modified if the session wants rolls; at most one
Named item equipped per soldier.

## 7. C — Weapon customisation

| Attachment | Effect (illustrative) | Compatibility | Notes |
|---|---|---|---|
| Optic (red dot, 4×, 8×, thermal) | Sight picture, zoom, target acquisition | Rail | Replaces today's separate scoped weapon ids |
| Suppressor | Shot noise radius down (stealth), slight velocity loss | Muzzle thread per calibre family | Needs per-weapon noise (U-206) |
| Magazine | Capacity vs reload time and handling | Weapon family | Interacts with reserve ammunition (U-199) |
| Stock | Recoil and sway vs ADS speed | Weapon | |
| Barrel | Range and spread vs handling | Weapon | |
| Grip / bipod | Recoil, prone/deployed stability | Rail / underbarrel | Bipod suits LMGs and Marsh |
| Underbarrel launcher | A grenade launcher (the M203 class in ADR-020's list) | Underbarrel | Ammunition is equipment |
| Light / laser | Hip-fire accuracy, low-light | Rail | Only if night missions exist |

Compatibility options: **per-weapon lists** (precise, more data), **mount
types** (rail, muzzle thread, underbarrel, magazine well per calibre family —
simpler and extendable), or **free** (anything fits — least grounded).
Changing attachments: **anywhere** (fiddly, combat abuse), **out of combat
only** (a hold action), **at the debrief/loadout screen and supply caches**
(simplest, no mid-fight menus — VISION adaptation 3).
Cosmetics (camouflage, wear) are optional and separate from function.

**Where should the excitement come from?** New weapons are rarer milestones;
attachments are the steady stream; named items are the trophies. Each feeds a
different time scale.

**Recommended default:** mount-type compatibility; functional attachments
only at first (no cosmetics); change at the loadout screen and at supply
caches/checkpoints, never mid-firefight; existing scoped variants migrate to
base weapon plus optic.

## 8. D — Inventory and storage

| Question | Options | Recommended default |
|---|---|---|
| What a soldier carries in a mission | Today's slots for everyone · weight/bulk capacity · grid inventory | **The same slots for every character** (primary, second weapon, sidearm, equipment, grenades, kits), defined by item size, not by who carries it |
| Two primaries | Everyone, under today's weapon rule (second must be AR/SMG/shotgun; none with an LMG or sniper) · nobody (primary + sidearm) · a carry "rig" found as loot | **Everyone, under today's weapon rule** (transitional, simplest equipment-based rule); a rig item is a good later loot idea |
| Between missions | Per-soldier loadout only (today) · **squad stash** shared by the campaign · per-player storage | **Per-soldier loadout plus a campaign squad stash** |
| Player/account storage | Needs a new ADR (ADR-019 says nothing follows a person between campaigns) | **Not now**; revisit with progression (§10) |
| Capacity | Unlimited · fixed stash size · expandable | **Fixed, generous stash** (e.g. 60 items) with sorting; duplicates collapse |
| Duplicates | Keep all · stack · auto-convert to salvage/collection credit | **Auto-convert duplicate Standard items**; keep Named items unique per campaign |
| Dropping and retrieving | Today's ground items (120 s despawn for drops) | Keep; items the squad found are flagged so they do not despawn before the mission ends |
| Persistence after completion | Today: loadout written on win | **Banked on win** (§5); stash written in the same transaction |
| Switching characters | Kit belongs to the soldier (ADR-001) | **Kit stays with the soldier**; the player takes over that soldier's kit |
| Disconnects | Held seat keeps the soldier | **Unchanged**: the soldier and its kit wait for the player or go to a bot |

Which **current restrictions change** is §14.

## 9. E — Multiplayer loot ownership

| Model | How | For | Against |
|---|---|---|---|
| E1 Shared physical items | One item in the world; whoever picks it up has it (today) | Grounded, tactical (grab the RPG now); no duplication | Grabbing ahead of friends |
| E2 Instanced per player | Each human sees their own drops | No theft | Unreal in a shared world; bots need a rule; multiplies items |
| E3 Squad-owned | Everything found belongs to the campaign squad; banked to the stash | Matches ADR-019 (campaign owns soldiers); works for 1–6 humans and bots alike; no theft | Personal ownership feeling is weaker |
| E4 Hybrid | E1 in the mission; E3 for persistence; optional personal cosmetics/collection credit for each human present | Grounded play plus fair persistence | Two ideas to explain |

Rules the session should confirm:
- **Bots** may pick up items when ordered (U-200) and their finds belong to
  the squad like anyone's.
- **Joining and leaving** never moves items: soldiers own kit; the campaign
  owns the stash (ADR-019).
- **Allocation between missions:** the host assigns stash items to soldiers at
  the loadout screen (host already chooses runs, CAMPAIGN Q2), or each human
  equips the soldier they occupy. Default: whoever occupies a soldier may
  equip it from the stash; the host can override.
- **Trading** between campaigns: not in scope (needs accounts and anti-abuse).
- **Duplication:** every persistent item is one server-issued instance with
  exactly one location (world, soldier, stash); moves are transactional.

**Recommended default:** E4 — shared physical items in missions, squad/campaign
ownership for persistence, with per-human collection credit as an optional
later addition.

## 10. F — Progression

| Axis | Options | Recommended default |
|---|---|---|
| Gear | The loot itself | **Primary progression axis** |
| Soldier | Rank and XP per campaign soldier (built) | Keep; ranks may unlock stash slots or loadout options, not stats |
| Player / account | Per-person rank, collection, cosmetics across campaigns | **Not now**; needs a new ADR superseding ADR-019 §2 |
| Campaign | Missions completed, stash, named items found | **Yes**: the campaign is the save |
| Weapon proficiency | DS1's per-weapon skill stars; handling bonuses with use | **Defer**; if adopted, small and capped (handling, not damage) |
| Unlocks | Supply options, mission-start kit choices, stash size | Modest unlocks from rank and completion |
| Long-term goals | Collection log per mission, named items, medals (CP-33), bonus conditions | **Collection log + medals** |

Power-creep guardrails: no gear score; damage bands bounded; enemies do not
scale with gear; the director budget stays human-count only (ADR-001) unless a
difficulty setting (CP-32) is added. **No cooldown character abilities**
(owner deferral stands).

## 11. G — Replayability and loot farming

- **Replay pools:** each mission has a first-clear reward and a repeat table;
  each has 1–2 **signature named items** with known sources (an HVT, a hidden
  cache) and bad-luck protection.
- **Hidden caches** draw their location each run from authored sockets, so
  replays reward reconnaissance rather than memorising.
- **Checkpoints:** ground loot is already saved with the checkpoint; a retry
  restores the world as it was, so nothing re-drops for a second pick-up. Since
  items bank only on success, a retry cannot duplicate.
- **Failure:** a failed run banks nothing new; what the soldiers carried in
  stays (they had it from the campaign file — CAMPAIGN Q6).
- **Capture:** a captured soldier's carried kit — the session decides whether
  it is lost, held with them and recovered on rescue (default: **recovered on
  rescue**, which makes the rescue matter), or left on the ground.
- **Keeping repeats fresh:** varied cache placement, bonus conditions, the
  stealth/loud choice, difficulty settings if adopted (CP-32).
- **Campaign vs replay runs:** separate prisoner pools stay; replays may
  bank loot to the same stash (D6: "replaying a mission is how players fetch
  different weapons"). Default: yes, with the repeat table.

## 12. H — Optional long-term systems (evaluated, not approved)

| System | Fit with Sandline | Cost | Recommendation |
|---|---|---|---|
| Crafting | Low (field soldiers do not craft guns) | Medium–high | No |
| Item upgrades | Medium if framed as armourer modifications | Medium | Later, maybe |
| Salvaging duplicates | Medium (parts for attachments) | Low–medium | Maybe, as duplicate conversion |
| Vendors / quartermaster | Medium (requisition between missions) | Medium | Maybe later: requisition with merit points |
| Trading between players | Low (accounts, abuse) | High | No |
| Cosmetic customisation | Medium (camo, wear) | Medium (art pipeline) | Later |
| Unique item collections | High (collection log) | Low | **Yes**, early |
| Equipment sets | Low–medium (set bonuses invite power stacking) | Medium | No |

## 13. I — Technical architecture

Constraints: AGENTS.md rules 3–5, ADR-012 (authoritative server), ADR-014
(determinism), ADR-019 (host-owned campaign, SQLite), ADR-009 (bit-packed wire).

- **Item definitions** — data in `packages/shared/src/data/items/*.json`,
  zod-validated, with stable string ids (`carbine`, `sniper-bolt-left`,
  `opt-4x`), a category, size/slot, handedness (`right | left | any`), mount
  points and accepted mounts, rarity tier, trait ids, and a definition
  version. Weapons, projectiles and equipment become item categories; existing
  `weapons.json`/`projectiles.json` rows map to them without changing ids.
- **Item instances** — `{ instanceId, defId, defVersion, tier, traits?, attachments: instanceId[], origin: {mission, run, source}, createdAt }`.
  `instanceId` is server-issued, unique within a campaign, never reused.
- **Generation** — on the host only, from a seeded PRNG in `packages/shared/src/math`
  seeded by campaign id, mission, run number and a per-run drop counter, so a
  test can reproduce a drop exactly; no `Math.random` (ADR-014).
- **Wire** — snapshots keep carrying compact definition indices for drawing
  (as today); inventories travel as reliable messages with per-session
  handles for instances; `PROTOCOL_VERSION` bumps per AGENTS.md.
- **Persistence** — campaign tables gain the stash and instance records; the
  soldier loadout references instances; writes stay at checkpoints and mission
  end, one transaction each (ADR-019). Migration replaces today's numeric
  indices (`GroundCheckpoint.weapon`, `SlotCheckpoint.equipment`) with string
  ids first, then instances.
- **Anti-duplication** — invariant: an instance is in exactly one place (world,
  soldier, stash, held with a prisoner); every move is a single authoritative
  operation; save writes are idempotent; property tests assert conservation.
- **Item-version changes** — definitions carry versions; a migration table
  maps renamed or retired ids; owned items are converted, never deleted.
- **Testing** — unit tests for generation tables and compatibility; headless
  multiplayer tests for pick-up races, join/leave, switch, disconnect, capture
  and checkpoint retry; save-migration fixtures; conservation property tests.
- **Limits** — ground items (today 24 drops plus authored), stash size,
  per-entity snapshot budget (ADR-012), message sizes.

## 14. Restrictions audit and recommended reconciliation

Every current character- or class-keyed equipment rule (code audit 2026-10-16;
they apply only on class-loadout sessions). U-194 implements the
reconciliation once the decisions marked are answered.

| # | Restriction | Where | Kind | Recommended reconciliation | Decision |
|---|---|---|---|---|---|
| X1 | Only Preach and Holloway may carry two primaries (`dualPrimary`) | `classes.json`, `Session.takePickupAt` | Character | Apply the weapon-based rule to every character | L-08 |
| X2 | Two primaries only AR/SMG/shotgun; none with an LMG/sniper | `weapons.ts`, `Session.takePickupAt` | Equipment | Keep (equipment-based) unless the session chooses another carry model | L-08 |
| X3 | Holloway has no pistol and can never take one (`canTakePistol` needs the class to list one) | `classes.json`, `Session.canTakePistol` | Character | He **starts** without one; anyone may pick a pistol up | L-09 |
| X4 | A second primary gives up the pistol | `Session` `carries` | Equipment | Decide with the carry model | L-08 |
| X5 | Marsh takes only left-handed guns | `Session.leftHandedShooter`, `weapons.ts canWield` | Trait (kept) | Keep; define which categories are handed (`any` for pistols, launchers, knife) | L-10 |
| X6 | Nobody else may take a left-handed gun | `Session` (U-052) | Equipment-handedness | Default: keep (left-handed variants are Marsh's pool); the alternative lets anyone use them | L-11 |
| X7 | Marsh acquires left-handed guns only through authored loot, not exchanges | ADR-001 2026-09-27 | Character | **Superseded by ADR-024**: any acquisition path | — |
| X8 | Marsh's starting P7 is right-handed and he cannot retake it once dropped | `weapons.json`, `Session` | Data inconsistency | Make sidearms `handedness: any` | L-10 |
| X9 | Holloway cannot ADS and has no first-person view | `classes.json` `ads`, `firstPerson`; `Session.mayAim`; client view state | Trait | Default: keep third-person and no iron-sight ADS, but allow a magnified optic's scope view so scoped loot works for him | L-12 |
| X10 | Only Holloway throws placed charges; everyone else places them | `classes.json` `throwsPlaced` | Trait | Keep as his personal characteristic; everyone may carry and place every charge | L-13 |
| X11 | One equipment item per character (slot 5) | `classes.json` `equipment`, `Session.equipmentFor` | Slot rule | Decide with the carry model; pickups already accept any item | L-08 |
| X12 | Supply caches refill only the class's spawn pouch; other equipment is `incompatible` | `supplyCaches.ts`, `Session.pouchFor` | Character | Refill by what the soldier carries, capped by item data | L-14 |
| X13 | Respawn on the range returns the class guns | `Session.restorePrimary` | Range-only | Keep for the range; missions have no respawn | — |
| X14 | Frag cannot be dropped or picked up as equipment | `Session` | Equipment | Allow with the carry model | L-08 |
| X15 | Bots never pick up or drop | `Session` (autonomous slots skip) | Capability gap | Ordered pick-up and hand-off (U-200) | L-15 |
| X16 | Enemy drop table never yields an LMG; enemies carry carbines/LMGs only | `pickups.json`, `enemies.json` | Data | Revisit with acquisition tables | L-01 |
| X17 | Reloads are unlimited (no reserve ammunition) | `weapons.ts finishReload` | Gap vs series | Finite reserve per weapon family (U-199) | L-16 |

## 15. Open decisions (answer "agree" or choose)

| ID | Question | Options | Recommended default |
|---|---|---|---|
| L-01 | Where does loot come from? | Any mix of §5 sources | Enemy drops (ordinary), world loot and hidden caches (better), HVTs and objectives (best), debrief reward |
| L-02 | Guaranteed or chance? | Guaranteed · chance · baseline + chance | Baseline + chance with bad-luck protection |
| L-03 | When does loot become permanent? | On pick-up · at checkpoints · on mission success | On mission success (banked) |
| L-04 | Overall model | A field kit · B variants · C workshop · D procedural | A + C (curated weapons, attachments as the stream, few named items) |
| L-05 | Rarity tiers | None · three (Standard, Modified, Named) · five colours | Three, shown by word and icon |
| L-06 | Fixed or rolled attributes | Fixed · bounded rolls · rolls on Modified only | Fixed now; bounded rolls only on Modified, later, if wanted |
| L-07 | Named items | None · one per soldier · unlimited | Yes, at most one equipped per soldier |
| L-08 | What every soldier carries | Today's slots for all · weight · rig items | Today's slots for every character; two primaries under the weapon rule for all |
| L-09 | Holloway's pistol | Starts without, can pick up · never | Starts without, can pick one up |
| L-10 | Which categories are handed | All firearms · rifles/LMGs/SMGs/shotguns handed, pistols/launchers/knife `any` | The second |
| L-11 | Can right-handed soldiers use left-handed variants? | No (Marsh's pool) · yes · yes with a penalty | No |
| L-12 | Holloway's third-person/no-ADS trait vs scoped loot | Keep fully · scope view for magnified optics only · remove | Scope view for magnified optics only |
| L-13 | Who throws placed charges | Holloway only (trait) · item property · everyone | Holloway only; everyone places |
| L-14 | Supply caches | Class pouch caps · carried-item caps | Carried-item caps from item data |
| L-15 | Bots and loot | Never · on order · on order and to fill empty slots | On order (U-200) |
| L-16 | Ammunition | Unlimited reloads (today) · finite reserve by weapon family | Finite reserve, pick-up from same-family weapons, give to squadmates |
| L-17 | Attachments in scope? | No · functional · functional + cosmetic | Functional first |
| L-18 | Attachment compatibility | Per weapon · mount types · free | Mount types |
| L-19 | When attachments change | Anywhere · out of combat · loadout screen and caches | Loadout screen and caches |
| L-20 | Storage between missions | Soldier only · squad stash · player storage | Soldier loadout + campaign squad stash |
| L-21 | Stash size and duplicates | Unlimited · fixed · expandable; keep/convert | Fixed generous stash; auto-convert duplicate Standard items |
| L-22 | Ownership model | E1–E4 | E4 hybrid (shared physical, squad-owned persistence) |
| L-23 | Who equips soldiers from the stash | Host only · the soldier's occupant · both | Occupant, host may override |
| L-24 | Progression axes | Gear, soldier, player, campaign, proficiency | Gear + campaign + soldier rank; no player account yet |
| L-25 | Account-wide progression (needs an ADR superseding ADR-019 §2) | Now · later · never | Later, with its own ADR |
| L-26 | Weapon proficiency | No · capped handling bonus · DS1-style stars | No for now |
| L-27 | Replay rewards | Same as first · repeat table · first-clear only | First-clear reward + repeat table with signature items |
| L-28 | A captured soldier's kit | Lost · held and recovered on rescue · dropped | Held and recovered on rescue |
| L-29 | Optional systems | §12 | Collection log yes; salvage as duplicate conversion maybe; others no or later |
| L-30 | Where rewards appear | Debrief only · in world · both | Both: world items in mission, banked list at the debrief |

## 16. Proposed agenda for the owner's design session (about 2 hours)

1. **Goals check (10 min)** — agree §1; name two moments the owner wants players
   to remember ("found the named rifle in the dealer's compound").
2. **Model choice (20 min)** — §4 and L-04; look at one example item from each.
3. **Acquisition and banking (20 min)** — L-01 to L-03, L-30; walk Mission 1:
   what drops where, what the debrief shows.
4. **Rarity and named items (15 min)** — L-05 to L-07.
5. **Freedom rules (20 min)** — §14 and L-08 to L-16: carry slots, Holloway,
   Marsh and handedness, ammunition.
6. **Attachments (15 min)** — L-17 to L-19.
7. **Storage, ownership and co-op (15 min)** — L-20 to L-23, L-28.
8. **Progression and replay (15 min)** — L-24 to L-27, L-29.
9. **Order of work (10 min)** — §17; choose the first playable slice.

Questions to bring back answered: the thirty decisions above (most need only
"agree"), the first slice, and any item the owner already imagines (names are
original IP; no real trademarks, ADR-020).

## 17. Implementation phases (cards)

| Phase | Card | Depends on | Unblocked by decisions |
|---|---|---|---|
| 1. Research and owner design session | [U-184](../backlog/U-184.md) | this document | the session itself |
| 2. Approved loot and progression specification | [U-185](../backlog/U-185.md) | U-184 | all L-decisions |
| 3. Inventory and persistence architecture (ADR) | [U-186](../backlog/U-186.md) | U-185 | L-08, L-20–L-25 |
| 4. Item data and equipment foundations | [U-187](../backlog/U-187.md) | U-186 | L-10, L-17, L-18 |
| — Reconcile character restrictions | [U-194](../backlog/U-194.md) | U-184 (decisions only) | L-08–L-14 |
| — Left-handed variants across categories | [U-195](../backlog/U-195.md) | U-185, U-187 | L-04, L-05, L-10, L-11 |
| 5. Multiplayer ownership and synchronisation | [U-188](../backlog/U-188.md) | U-187 | L-22, L-23 |
| 6. Loot generation and acquisition | [U-189](../backlog/U-189.md) | U-188 | L-01–L-03, L-05–L-07 |
| 7. Mission rewards and replay progression | [U-190](../backlog/U-190.md) | U-189 | L-27, L-28, L-30 |
| 8. Attachments and customisation (if approved) | [U-191](../backlog/U-191.md) | U-187 | L-17–L-19 |
| 9. Balancing and long-term progression (if approved) | [U-192](../backlog/U-192.md) | U-190 | L-24–L-26, L-29 |
| 10. QA, playtesting and tuning | [U-193](../backlog/U-193.md) | the phases built | owner playtest verdict |

Related, outside the epic: finite ammunition and give-ammo (U-199), ordered
bot pick-up and hand-off (U-200), suppressors (U-210), binoculars (U-220).
