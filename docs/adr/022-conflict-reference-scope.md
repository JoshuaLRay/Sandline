# ADR-022: The active Conflict reference is Desert Storm, Desert Storm II and Global Storm

- **Status:** Accepted
- **Date:** 2026-10-16
- **Plan reference:** [VISION.md](../VISION.md) "The reference"; supersedes decision 1 of [ADR-021](021-conflict-gameplay-reference.md); [CONFLICT-PARITY](../design/CONFLICT-PARITY.md)

## Context

ADR-021 made the Conflict series the gameplay reference: *Desert Storm* (2002)
and *Desert Storm II – Back to Baghdad* (2003) primary, *Conflict: Vietnam*
(2004) and *Conflict: Global Storm* (2005) secondary "where the first two are
silent". Two secondary games pull in different directions (a jungle war with a
different squad; a modern global campaign with a reworked command system), and
the series also has *Denied Ops* (2008), which some sources list with it. An
agent resolving a detail by "what the series did" needs one unambiguous list.

On 2026-10-16 the owner narrowed it: "These are the only three Conflict games to
use as active design references going forward: Conflict: Desert Storm,
Conflict: Desert Storm II — Back to Baghdad, Conflict: Global Storm. Desert
Storm 1 and 2 remain the primary influences. Use Global Storm selectively for
improvements such as coordinated squad commands. Remove Conflict: Vietnam and
Denied Ops from the active design-reference policy."

## Decision

1. **Active references, in order:**
   1. *Conflict: Desert Storm* (2002) — primary;
   2. *Conflict: Desert Storm II – Back to Baghdad* (2003) — primary;
   3. *Conflict: Global Storm* (2005; *Global Terror* in North America) —
      **selective**: consulted for improvements the owner names or that fix a
      known weakness of the first two, chiefly squad command (Global Storm's
      reworked order interface, orders to plant charges at a point, to heal or
      protect a squadmate, and sequenced "advanced orders" released together).
      It is never used to override a clear Desert Storm / Desert Storm II answer.
2. **Not active references:** *Conflict: Vietnam* and *Conflict: Denied Ops*.
   An agent does not use them to settle a detail. Existing historical mentions
   (for example the parity tracker's research notes) may stay if they are
   clearly marked as history and do not decide anything.
3. **ADR-021 otherwise stands.** Its default resolution order now reads, at
   step 3: *what Desert Storm / Desert Storm II did — or, where the owner points
   to it or the first two are weak, what Global Storm did — adapted to six
   soldiers and online co-op*, recorded as `Conflict default: …`.
4. **Original IP is unchanged** (ADR-020 §4, ADR-021 §4). Mechanics, structure
   and feel only; no names, characters, missions, maps, dialogue, logos, art,
   audio, UI layouts or level geometry from any Conflict game.
5. **Owner directions beyond the series stand and are not "Conflict defaults":**
   loot-driven equipment progression and equipment freedom
   ([ADR-024](024-equipment-freedom-and-loot.md)), flexible mission maps
   ([ADR-023](023-flexible-mission-routes.md)), capture and rescue, the mobile
   commander. The reference is a floor for the squad-tactics core, not a
   ceiling on owner ideas.

## Consequences

- One list, in order, with a stated role for each game; "Conflict default"
  citations name the game they come from.
- Global Storm becomes the named source for coordinated-command work (the
  synchronised-orders card, U-202) without dragging its setting, squad or
  pacing into the core.
- Facts about Global Storm come from secondary sources (reviews, product
  listings); cards label them *unverified* until confirmed, as the tracker
  already does for the first two.

## Alternatives rejected

- **Keep Vietnam as a secondary reference.** Rejected by the owner.
- **Desert Storm only.** Rejected: Desert Storm II's additions (form up, hit the
  dirt, a death failing the mission) are already adopted, and Global Storm's
  command improvements are wanted.
- **Treat all three equally.** Rejected: Global Storm's changes are wanted
  selectively; equal weight would let it override the primary games' feel.
