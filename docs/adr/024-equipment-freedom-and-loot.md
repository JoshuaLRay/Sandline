# ADR-024: Equipment freedom and loot-driven progression

- **Status:** Accepted (direction and principles). The loot system's mechanics are **not** decided here; they wait for the owner's loot design session ([U-184](../backlog/U-184.md)).
- **Date:** 2026-10-16
- **Plan reference:** [VISION.md](../VISION.md) P1, P6, P8 and anti-goals; [LOOT-PROGRESSION.md](../design/LOOT-PROGRESSION.md); [squad-roster.md](../design/squad-roster.md); supersedes in direction the weapon-handling clauses of ADR-001's 2026-09-27 addendum and its U-022 addendum; relates to [ADR-019](019-persistence.md)

## Context

Until now every character had a fixed role. The roster decisions of
2026-09-27 to 2026-09-30 (ADR-001 addenda, U-019–U-022, U-029, U-048–U-058) fixed
each character's loadout and equipment, let only Preach and the support carry
two primaries, kept Marsh to left-handed guns that reach him only through
authored loot (not exchanges), and let only the support throw C4. VISION.md's
anti-goals ruled out "loot rarity". Campaign decision D6 already carries
weapons, ammunition and gear between missions and calls replays the way to
"fetch different weapons for the squad".

On 2026-10-16 the owner set a new direction: "A major new direction is
loot-driven progression. Players should have substantial freedom to equip their
characters and develop their preferred playstyles through weapons, attachments,
equipment, and rewards discovered while playing." Inspirations named:
Borderlands, RuneScape, Destiny — "while preserving the grounded tactical
gameplay and squad coordination that make Sandline distinctive." And: "Do not
independently decide the entire loot system" — a dedicated owner planning
session decides it.

## Decision

### Accepted now (owner, 2026-10-16)

1. **Loot-driven progression is a product pillar** (P8 in VISION.md). Finding
   valuable equipment during missions, and earning progression by completing
   and replaying missions, is part of what Sandline is.
2. **Starting loadouts are starting configurations, not classes.** The six
   characters keep their names, identities, default starting equipment and
   personal characteristics. Preach starting with an AR, Brennan with an LMG,
   Holloway with an SMG and shotgun, Ortiz with a scoped AR, Marsh with a
   left-handed bolt-action and Vance with a semi-automatic sniper describes
   where each begins, not what each must use.
3. **Equipment freedom.** Weapons, attachments, explosives, utility and medical
   equipment and tactical devices are droppable, transferable, lootable and
   equipable by **any** character. The only limits are:
   - **handedness** (decision 4); and
   - **general inventory and compatibility rules** that apply to every
     character equally and are based on the equipment itself (size, slot,
     attachment fit), to be defined by the loot design session.
   No new character-exclusive equipment rule may be introduced.
4. **The left-handed exception.** Marsh keeps his left-handed requirement: he
   can equip only left-handed-compatible firearms. Left-handed loot is **not**
   limited to sniper rifles: the loot pool must include compatible left-handed
   variants across several categories, including rare left-handed assault
   rifles, light machine guns, sniper rifles and other suitable firearms, so
   Marsh can develop into different roles. He may obtain a compatible firearm
   by any acquisition path the loot system has (finding it, an enemy or world
   drop, a squadmate's hand-off, a reward); the 2026-09-27 clause that he
   "cannot acquire weapons through character/enemy exchanges" is superseded.
5. **Existing character-specific restrictions are to be reconciled, not
   silently kept.** Each is listed, with its source, code location and a
   recommended reconciliation, in LOOT-PROGRESSION.md §11 and carded as
   [U-194](../backlog/U-194.md). Until U-194 lands they remain in code, labelled
   as transitional.
6. **Grounded combat comes first.** Loot must not create power creep that makes
   positioning, cover, suppression or squad coordination irrelevant. Character
   cooldown abilities stay deferred (ADR-001 addendum 2026-09-29) and are not
   reintroduced through loot.
7. **Engineering constraints that hold whatever is decided:** item definitions
   are data (zod-validated JSON, AGENTS.md rule 3) with stable string IDs;
   generation, ownership and persistence are server-authoritative (ADR-012);
   nothing new is persisted by array index; one-to-six humans and bots share
   one path (ADR-001).

### Not decided here (the loot design session, U-184)

Acquisition sources and drop rates; rarity tiers; fixed versus randomised
attributes; named items; attachments and their compatibility; inventory slots
and carry capacity (including whether "two primaries" survives); storage
(per character, squad, campaign or account); multiplayer ownership, allocation
and trading; bot looting; progression axes (gear, soldier, player, campaign,
account) and their persistence scope; replay rewards and farming limits;
crafting, upgrades, salvage, vendors, cosmetics, collections and sets. The
options, trade-offs and recommended starting assumptions are in
LOOT-PROGRESSION.md. No loot implementation card becomes READY while a decision
it needs is open.

## Consequences

- VISION.md's anti-goal "no loot rarity" is withdrawn; "no perks" is narrowed to
  character perk trees and cooldown abilities. Rarity itself remains a
  workshop question, not a commitment.
- The roster's per-character equipment table becomes a table of starting
  equipment; squad-roster.md D-6, D-9 and D-10 are marked superseded in
  direction; D-3/D-7 (the support's third-person, no-ADS trait) and the
  support's throwing of placed charges are personal characteristics whose
  interaction with equipment freedom is an open decision with a default (U-194).
- **ADR-019 tension.** Progress today lives on the host's campaign; "nothing
  follows a person between campaigns". Account-wide or player-owned loot would
  need a new ADR superseding ADR-019 §2. The workshop decides; until then loot
  is assumed campaign-scoped (the cheapest reversible default).
- **Save format.** Saves and checkpoints store some weapons and equipment as
  numeric indices (`GroundCheckpoint.weapon`, `SlotCheckpoint.equipment`).
  Persistent loot needs stable identifiers and a migration (U-187).
- Conflict parity rows that assumed fixed roles (CP-01, CP-02) are re-read as
  "starting specialists"; CP-03/CP-33 progression rows point at the loot epic.

## Alternatives rejected

- **Keep fixed roles and add loot only within each role.** Rejected by the
  owner: characters must be able to develop different roles.
- **Remove the left-handed trait.** Rejected by the owner: Marsh keeps it; the
  loot pool must serve it instead.
- **Decide the loot system now from the inspirations.** Rejected by the owner:
  a dedicated design session decides it, from a prepared set of options.
