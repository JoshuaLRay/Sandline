# ADR-023: Missions offer varied approaches; three separated lanes are a guideline, not a rule

- **Status:** Accepted
- **Date:** 2026-10-16
- **Plan reference:** [MAP-MISSION-CREATION.md](../design/MAP-MISSION-CREATION.md); [CAMPAIGN.md](../design/CAMPAIGN.md) D4/D5; supersedes the 2026-10-04 owner direction's three-lane requirement for future maps; ADR-001 ("objectives exposing two viable approach routes"), ADR-021 decision 5

## Context

On 2026-10-04 the owner required every campaign map to have **three physically
distinct lanes**: a direct assault, an overlook/support route and a narrower
separate flank, with no intermediate links to the flank by default. The
Qalat Road was rebuilt to that standard and the Kestrel Dam was designed to it.

On 2026-10-16 the owner relaxed it: "The three-route requirement is no longer
strict for every mission. We still like the idea of three meaningful
approaches, but this is now a general map-design guideline, not a mandatory
structural requirement. The concern is that ten missions with an assault road,
sniper ridge, and underground passage could become repetitive and formulaic."
Tactical opportunity and environmental believability matter more than route
counts; existing approved layouts are not to be redesigned automatically.

## Decision

1. **Guideline, not requirement.** A campaign map should generally offer more
   than one meaningful way to approach its objectives. Three approaches — a
   relatively direct assault, one with observation/overwatch or another
   positional advantage, and one allowing a flank, infiltration or other
   strategy — remain a useful **starting point**, not a template.
2. **Varied topology is allowed and expected.** Routes may intersect, merge,
   diverge, overlap and reconnect; they need not be physically separated for
   their whole length. A map may have two, three, four or more approaches, or be
   deliberately linear when its objective or environment justifies it (stated
   in its map record). Elevation is not always the second route; a hidden flank
   or underground passage is not always the third.
3. **Approved layouts stand.** The Qalat Road ([qalat-road.md](../design/maps/qalat-road.md))
   and the Kestrel Dam ([kestrel-dam.md](../design/maps/kestrel-dam.md)) keep
   their approved three-route geometry, separators and crossing registers, and
   their isolation proofs remain valid evidence. Changing either needs an
   approved map revision.
4. **Separation is a design choice, not a default.** When a map *does* declare a
   route separated (a sealed flank, an overlook you cannot drop from), that
   boundary must still be collision-backed and proven, using the existing
   crossing register and negative-path checks. A map that does not declare
   separation is not tested for it.
5. **What is reviewed instead of route counts:** meaningful tactical choice,
   environmental believability, engagement-distance variety, recon before
   contact, defensible and interesting enemy placement, return-trip play,
   coordinated six-person tactics, and navigation for bots and escorts.
   Playtests judge those (see the standard's review criteria), never merely
   whether three routes exist.
6. **Campaign variety.** Across the season, missions combine different mixes of
   open terrain, urban, interior, long-range overwatch, close quarters, vehicle
   threats, stealth, defence, escort and extraction. No mission must use all of
   them.

## Consequences

- Mission 3 onward can be shaped by its place and objective (a village raid, a
  convoy ambush, a night infiltration) rather than by a lane count.
- The level checks built for Qalat's isolation stay as tools for maps that
  declare separation; a per-map route-graph check replaces the implicit
  three-lane assumption (U-219).
- Review shifts from a pass/fail topology rule to judgement against written
  criteria. The criteria and the playtest questions are in the standard so the
  judgement is repeatable; the verdict is still the owner's.
- D4/D5's "three lanes and much longer" and Q5's "three 40 m lanes" in
  CAMPAIGN.md are read as historical sizing, not structure.

## Alternatives rejected

- **Keep three separated lanes for every mission.** Rejected by the owner: ten
  missions on one pattern become formulaic.
- **Redesign Qalat and Kestrel to the new guidance.** Rejected by the owner;
  approved layouts stay unless a revision is approved.
- **No guidance at all.** Rejected: the owner still wants multiple meaningful
  approaches and believable terrain; without written criteria every map review
  would start from nothing.
