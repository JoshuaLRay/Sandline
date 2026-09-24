# ADR-020: The setting — Afghanistan, winter 2001–2002, desert camouflage

- **Status:** Accepted
- **Date:** 2026-09-24
- **Plan reference:** header, §4.1, §7.11 (T-4.08, T-4.35, T-4.36); ADR-002, ADR-018

## Context

The plan has only ever said "in the spirit of early-2000s console squad
tactics games" and "original IP". It never named a time or a place. So the
defaults drifted toward whatever a desert suggested, and the look drifted
toward primitives: the code-built soldier (T-2.22, T-2.35) reads, in the
owner's words, "like something from Roblox".

On 2026-09-24 the owner set both:
- **Setting:** right after 9/11, in Afghanistan, not Iraq in the 1990s.
- **Look:** far more detailed characters, graphically like *Conflict: Desert
  Storm* (2002). That game is a fidelity reference, and nothing of it is
  used.
- **Camouflage:** desert, "to stay true to the game's name".

## Decision

1. **When and where.** Afghanistan, from late 2001 into 2002: mountain
   valleys, villages of mud-walled compounds (qalats), rock and dust, the
   first winter of the war.
2. **The player's side.** US infantry of the period, as a squad of six
   (ADR-001):
   - three-colour desert camouflage uniforms (DCU);
   - PASGT helmets in desert covers, with goggles;
   - Interceptor vests with MOLLE pouches, and three-day packs;
   - tan boots and gloves;
   - M4 carbines, an M249, and M203 grenades (the loadout's data names
     them in T-4.36).

   Squad slots are told apart by a coloured armband and a band on the
   helmet, the palette's `accent`.
3. **The enemy.** Irregular fighters of the period:
   - shalwar kameez, waistcoats, pakol caps and turbans, scarves, chest
     rigs;
   - AK-pattern rifles, PKM machine guns and RPG-7s.

   Their model is T-4.35. Until it lands, enemies keep the code-built
   soldier in the `enemy` palette.
4. **Original IP holds.** No real unit insignia, names, call signs or
   places. Equipment is generic to the period, and no manufacturer's
   marking is reproduced.
5. **Fidelity target.** A 2002 console character, not a 2002 console's
   limits:
   - shaped, smoothly weighted forms of a few thousand triangles;
   - a 1024² hand-painted-style diffuse, smoothly filtered;
   - gear modelled where it breaks the silhouette and painted where it
     does not.

   `docs/art/direction.md` is the brief every generator works to.

## Consequences

- **The environment follows.** The kit's plaster, mud brick and concrete
  (T-4.10) already fit a qalat. Rock, mountain slopes and village props
  come with the levels (T-4.13 onward).
- **The enemy archetypes** (ADR-015: rifleman and MG) keep their behaviour
  and get a fighter's look (T-4.35) and period weapons (T-4.36).
- **ADR-018 stands** (art authored as code). Its addendum of this date
  raises the character fidelity target.
- **The point-sampled look of T-2.35–T-2.38 is superseded for the squad.**
  Smooth filtering is part of the fidelity target. The code-built soldier
  stays as the fallback, as `?codesoldier`, and as the enemy until T-4.35.
- **Sensitivity.** A real, recent war is the setting. Enemies are fighters
  and never civilians. Nothing in the game mocks a people or a faith. The
  tone is that of the period's military shooters, not satire.

## Alternatives rejected

- **Iraq in the 1990s (Desert Storm itself).** The owner chose Afghanistan
  after 9/11.
- **Woodland or mixed camouflage.** Both were worn in 2001–2002. The owner
  chose desert.
