# The squad roster: six named characters (U-019)

**Status: DECIDED for this version (2026-09-29).** On 2026-09-27 the owner
confirmed Preach, the snipers' handedness and starting weapons, weapon
acquisition rules and the two-primary limits. On 2026-09-29 the owner accepted
the remaining proposals (names, the support's speed and no-pistol loadout, free
slot choice), ruled that the support is third-person only, and **deferred
character skills to a later version of the game**. Two-primary keys and pickup
replacement stay for U-022. No gameplay is implemented by this document.

## Approved: the owner's requirements (2026-09-26)

From [the owner's feedback](../backlog/2026-09-26-feedback.md), verbatim in substance:

1. The squad is **six unique, named characters**, each with their own weapons and skills.
2. Roles: **two snipers, one LMG, one AR, one scoped AR, one support.**
3. The support **can't ADS "(or fps)"**, holds **two primaries, an SMG and a shotgun**, and **runs a bit faster**.
4. The squad leader's name is **Preach**. The remaining names and individual
   skills are still open unless noted below.

## Approved owner decisions (2026-09-29)

1. **Names accepted as written:** Preach, Brennan, Holloway, Ortiz, Marsh, Vance (IDs `preach`, `brennan`, `holloway`, `ortiz`, `marsh`, `vance`).
2. **Skills are out of this version.** The skill table below is kept as a *possible future design only*; nothing in it is approved or scheduled. The characters differ by role, loadout, speed and handedness for now.
3. **Support:** +10% speed (configurable), an SMG and a shotgun, **no pistol**, no ADS, and **third-person only**: no first-person view at all, by any path.
4. **Any free slot** may be taken by a joining player.
5. Two-primary keys and pickup replacement stay open in U-022.

## Approved owner decisions (2026-09-27)

1. Slot 0's leader is named **Preach**; the documented roster ID is `preach`.
2. Using the proposed slot mapping below, slot 4 (`marsh`) is the left-handed
   sniper and starts with a left-handed bolt-action sniper rifle. Slot 5
   (`vance`) starts with a semi-automatic sniper rifle. U-020 supplies valid
   weapon definitions; the requested action types and handedness are fixed.
3. The other five characters may swap or pick up weapons from squadmates and
   enemy weapon drops. The left-handed sniper cannot acquire weapons through
   character/enemy exchanges and may use only left-handed firearms. His
   left-handed guns enter play through authored loot, including mission
   rewards. U-029 specifies the acquisition implementation.
4. **Only Preach and Support may carry two primaries.** Dual-primary weapons
   are limited to ARs, shotguns and SMGs. Neither may carry a second primary
   while holding an LMG or sniper rifle; all other characters carry at most
   one primary. U-022 owns the dual-primary rules.

Already settled by other decisions, and kept:
- **ADR-001:** six slots, always; bots fill the empty ones; a player possesses a slot's soldier, and a slot keeps its soldier's state between occupants.
- **U-025 and U-026:** every bot has a human commander, and a player may switch into a bot they command.
- **ADR-020:** US infantry, Afghanistan, 2001–02; original IP. No real people, units or trademarked weapon names.

## The proposed roster

| Slot | ID | Name / decision status | Role | Primary *(proposal)* | Second primary | Sidearm | Fireteam |
|---|---|---|---|---|---|---|---|
| 0 | `preach` | **Preach** *(approved leader name)* | AR, the squad lead | MK4 Carbine (`carbine`) | Eligible for a second AR, shotgun or SMG primary | P7 *(policy open)* | 1 (lead) |
| 1 | `brennan` | Spc. Walt Brennan | LMG | the squad LMG (`lmg`, a loadout version of the enemy's) | — | P7 | 1 |
| 2 | `holloway` | PFC Nate Holloway | Support | an SMG *(new, U-020)* | a shotgun (`breacher`) | none *(decided 2026-09-29)* | 1 |
| 3 | `ortiz` | Cpl. Dana Ortiz | Scoped AR, the second team's lead | MK4 with an optic *(new variant, U-020)* | — | P7 | 2 (lead) |
| 4 | `marsh` | Spc. Eli Marsh | Left-handed sniper | a left-handed bolt-action sniper rifle *(U-020)* | — | P7 | 2 |
| 5 | `vance` | Spc. Theo Vance | Sniper | a semi-automatic sniper rifle *(U-020; exact firearm/model remains open)* | — | P7 | 2 |

The role counts are two snipers (4, 5), one LMG (1), one AR (0), one scoped AR (3) and one support (2): the 2/1/1/1/1 the owner set.

The six IDs are unique, lowercase and stable. They are what saves, the wire and the data refer to; the names are display only and can change freely.

**Why these slots.** Fireteam 1 (slots 0–2, a wedge) is the assault team: the AR lead, the LMG's base of fire, and the fast close-range support. Fireteam 2 (slots 3–5, a file) is the overwatch team: the scoped AR lead and the two snipers. That matches the existing fireteam data (`squad.json`) and today's default split: team leaders in 0–2, marksmen in 3–5.

## One skill each *(DEFERRED: a possible future design, not part of this version)*

The owner deferred skills on 2026-09-29 ("they can come in a later version of the game, maybe"). Nothing below is approved or scheduled, and no task builds it.

Each skill is **bounded**: one effect, a duration, a cooldown, and a range where it has one. It is data-driven, as weapons and classes are (CLAUDE.md rule 3), and usable by a bot through the same path as a human (ADR-001: the squad plays the same with any number of humans). The numbers are starting points for a playtest, not tuning.

| ID | Skill *(proposal)* | Effect | Duration | Cooldown | Bot use |
|---|---|---|---|---|---|
| `preach` | **Rally** | squadmates within 15 m of him have their suppression cleared, and gain suppression 30% slower | 8 s | 90 s | when two or more squadmates are suppressed |
| `brennan` | **Hose** | his rounds add 50% more suppression | 10 s | 60 s | when firing on a target in cover |
| `holloway` | **Resupply** | hold interact 2 s beside a squadmate: +1 frag, magazine refilled | instant | 45 s | a squadmate with an empty pouch nearby |
| `ortiz` | **Spot** | the next target she marks is shown to the whole squad through walls | 10 s | 30 s | marks what she fires at |
| `marsh` | **Steady** | while aimed, no sway or bloom | 4 s | 20 s | before a long shot |
| `vance` | **Hide** | prone and still for 3 s: enemies see him at half their range until he moves or fires | while it holds | none (it is a stance) | holding prone on overwatch |

**Distinctness.** Rally is a squad buff, Hose is fire support, Resupply is logistics, Spot is information, Steady is precision, and Hide is concealment. No two overlap.

**The support's movement bonus** *(accepted 2026-09-29):* +10% walk and sprint speed, as one configurable number in the character's data, not a constant.

## Identity through possession, reconnect and saves

- **A character is a slot's**, not a player's. `preach` is always slot 0, whoever or whatever is playing him. That is ADR-001's model (a slot keeps its soldier), so:
  - a human joining slot 0 possesses Preach, and a bot leaving hands Preach back;
  - a player who drops and resumes within the grace (T-4.18) is Preach again: the held seat keeps its character, as it now keeps its class and pouch (U-024);
  - a U-026 switch into slot 4 makes that player Marsh, and hands Preach to his bot.
- **Saved campaigns** (T-4.23, ADR-019). A campaign soldier today is `{slot, classId, rank, xp}`. The proposal is to add `characterId` beside it. Because characters are fixed to slots, an old save migrates by slot, and rank and XP stay with the slot's soldier. `classId` becomes derived and is kept for old saves.
- **Replacing free class selection** (T-4.27). The room's class picker goes, since a character's loadout is fixed. What a player picks is **which character (slot)** they take, from those free when they join, and U-026's switch changes it mid-mission. `required: team-leader` becomes "slot 0 is always the squad lead", which the fixed roster guarantees.

## Remaining decisions for the owner

| # | Decision | Current state |
|---|---|---|
| D-1 | Sniper weapon details | **Decided:** slot 4 starts with a left-handed bolt-action sniper; slot 5 starts with a semi-automatic sniper. Exact models and weapon IDs remain for U-020. |
| D-2 | Character names | **Decided (2026-09-29):** Preach, Brennan, Holloway, Ortiz, Marsh, Vance. |
| D-3 | Each skill's effect, duration and cooldown | **Deferred (2026-09-29):** skills are left for a later version, maybe. The table is not approved. |
| D-4 | The support's speed bonus | **Decided (2026-09-29):** +10%, configurable. |
| D-5 | Whether Support keeps a pistol | **Decided (2026-09-29):** no pistol. |
| D-6 | Two-primary controls: key mapping and pickup replacement behavior (U-022) | **Partially decided:** only Preach and Support qualify; only ARs, shotguns and SMGs; no second primary while holding an LMG or sniper. Keys and exact replacement behavior remain open for U-022 (2026-09-29: left there). |
| D-7 | What "(or fps)" means for Support | **Decided (2026-09-29):** no first-person view whatsoever. Support is third-person only, and cannot ADS. |
| D-8 | Whether a player may take any free slot, or only the lowest one | **Decided (2026-09-29):** any free slot. |
| D-9 | Which enemy weapons are available as pickups | **Partially decided:** other characters may pick up enemy weapon drops; U-017's drop table and the left-handed sniper exception still apply. |

## Proposed ADR addendum

ADR-001 carries the original six-character direction. Its 2026-09-27 decision addendum records the newly approved details above. Remaining proposals and decisions stay open. A later addendum may record further choices, including:
- the roster (IDs, slots, roles);
- that T-4.27's two classes (Team Leader, Marksman) are replaced by the six characters' loadouts;
- that the slot picker replaces the class picker;
- ADR-020's weapon list (M4, M249, M203) extended by the rifles and the SMG U-020 adds, under original names.

## How U-023 would split, if skills are ever agreed

*Deferred (2026-09-29): not in this version.* One independently executable task per agreed skill, each with its data row, its server rule (authoritative, like every interaction), its bot use, its HUD and its tests. Until the owner agrees a skill's effect, its task does not exist, and **no ability here is treated as approved.**

- U-023a: Rally (Preach)
- U-023b: Hose (Brennan)
- U-023c: Resupply (Holloway)
- U-023d: Spot (Ortiz)
- U-023e: Steady (Marsh)
- U-023f: Hide (Vance)
- plus, from U-020 and U-021: the new weapons, the character data and slot binding, the save migration, and the support's two-primary controls (U-022).

## Checked against today's contracts

- **`classes.json`:** a class is `{name, short, health, guns, pouch, orders}`. A character row can be the same shape plus `slot`, `skill`, `speedScale` and `ads: false`. U-018's single-primary pickup rule needs the U-029 exchange/acquisition extension; U-022 defines the two-primary inventory for Preach and Support.
- **`squad.json`:** fireteam slots 0–2 and 3–5, unchanged.
- **Persistence (`CampaignDatabase`):** `{slot, classId, rank, xp}`, extended by `characterId` as above.
- **`weapons.json`:** U-020 must supply/confirm the left-handed bolt-action sniper and semi-automatic sniper, plus any other missing roster archetypes; handedness is part of weapon eligibility for slot 4.
- **ADR-001 and U-025/U-026:** unchanged. A character rides a slot, and command and possession are about slots.
