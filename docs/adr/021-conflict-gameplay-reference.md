# ADR-021: The Conflict series is the gameplay reference

- **Status:** Accepted
- **Date:** 2026-10-09
- **Plan reference:** header, §1; ADR-001, ADR-002, ADR-015, ADR-020

## Context

The plan has always described Sandline as "in the spirit of early-2000s console
squad tactics games", and ADR-020 named *Conflict: Desert Storm* (2002) as the
*visual fidelity* reference. Nothing said which game the *play* should match,
so every unspecified gameplay detail became either an owner question or an
agent's guess. The project is built entirely by AI coding agents; open
questions stall the queue, and guesses drift from the intended game.

On 2026-10-09 the owner stated the goal directly: the project must stay true to
being **a version of Conflict, but with six playable characters in the squad
rather than four**, built as efficiently as possible by agentic coding.

## Decision

1. **Reference.** *Conflict: Desert Storm* and *Conflict: Desert Storm II* are
   the primary gameplay reference; *Conflict: Vietnam* and *Conflict: Global
   Storm* are secondary, consulted only where the first two are silent.
   [docs/VISION.md](../VISION.md) states the pillars taken from them and
   [the parity tracker](../design/CONFLICT-PARITY.md) records, feature by
   feature, what the series did and what Sandline has.
2. **Six, not four.** The series' four-specialist squad becomes six soldiers in
   two fireteams of three (ADR-001 and its addenda). Every series mechanic that
   addresses "the squad" is adapted to six soldiers, two fireteams and up to six
   online humans, rather than copied for four.
3. **Default resolution order** for any gameplay or design detail an agent must
   settle:
   1. an explicit owner decision (card, design document or ADR addendum);
   2. a locked ADR;
   3. **what Desert Storm / Desert Storm II did, adapted to six soldiers and
      online co-op**, labelled as such in the card;
   4. the smallest reversible choice, labelled as a proposal.

   An agent uses step 3 instead of stopping for a question when the series has
   a clear answer and no owner decision or ADR conflicts. It records the
   reference ("Conflict default: …") so the owner can overrule it cheaply.
4. **Original IP still holds** (ADR-020 §4). The series supplies mechanics,
   structure and feel. No names, characters, missions, dialogue, logos, art,
   audio, UI layouts or level geometry are copied or closely imitated.
5. **Owner decisions that differ from the series stand.** The setting
   (ADR-020), the six-slot squad (ADR-001), large three-lane maps
   ([MAP-MISSION-CREATION](../design/MAP-MISSION-CREATION.md)), deferred
   character skills (ADR-001 addendum 2026-09-29) and the v1 exclusions
   (ADR-002) are deliberate differences, listed in VISION.md. This ADR does not
   reopen them; changing one still needs the owner and a new addendum or ADR.

## Consequences

- Agents can resolve most unspecified gameplay details without blocking on the
  owner, and their choices converge on one recognisable game.
- Prioritisation has a yardstick: work that closes a gap in the parity tracker
  for a core pillar outranks polish of something the series never had.
- The parity tracker must be kept current when a feature lands or a decision
  changes it; a stale tracker sends agents after the wrong gaps.
- Where the series was weak (contemporary reviews cite clumsy aim, two saves
  per mission, enemies spotting prone soldiers instantly, and squadmates who
  ignore cover and get themselves killed), "adapted" means matching its intent,
  not its failure. Sandline's bots are on the critical path (ADR-001) and must
  be better than the reference, not equal to it.
- Features Sandline added that the series never had (capture and rescue, the
  mobile commander) stay; the reference is a floor for the core loop, not a
  ceiling on owner ideas.

## Alternatives rejected

- **No named reference; decide everything case by case.** Rejected: that is the
  status quo the owner identified as increasingly inefficient.
- **Copy the series faithfully, four soldiers included.** Rejected: the six-man
  squad is the product requirement (ADR-001, ADR-015).
- **A broader "tactical shooter" reference set (Ghost Recon, SOCOM, Brothers in
  Arms).** Rejected: competing references give agents conflicting defaults.
  They may inform a solution only where the Conflict series has none.
