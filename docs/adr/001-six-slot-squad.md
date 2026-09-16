# ADR-001: Six-slot squad with AI backfill

- **Status:** Accepted
- **Date:** 2026-09-16
- **Plan reference:** §1.2

## Context

The source genre's core loop is one player commanding three AI squadmates and
hot-swapping between them. The product requirement is six-player co-op. Six
humans destroys that loop outright: the command layer becomes vestigial and
hot-swap becomes meaningless, because there are no AI squadmates left to command
or swap into.

Left unresolved, this forces two separate designs — a solo game and a co-op
game — with separate encounter tuning, separate mission layouts, and separate
balance passes for every player count in between.

## Decision

The squad is **always six soldiers**. Unfilled slots are bots. Any player may
issue orders to any bot. A player joining takes over a bot's entity in place; a
player leaving hands their entity back to bot control.

Missions are designed for a six-man element that splits into two three-man
fireteams, with objectives exposing two viable approach routes.

Encounter difficulty scales on **human count**, not squad size.

## Consequences

- Content is designed and tuned once. One player with five bots and six players
  with no bots run the same mission.
- Drop-in/drop-out is an entity possession swap, not a session rebuild. This is
  substantially simpler than the alternative and is why reconnect is cheap.
- The tactical command layer survives at every player count, preserving the
  pillar the genre rests on.
- **Friendly bot AI moves onto the critical path.** The game cannot ship without
  competent squadmate AI, because there is no player count at which bots are
  absent. This is a real cost and is tracked as R3.
- Hot-swapping into a squadmate is replaced by issuing orders to them. Players
  who want direct control of a specialist pick that class instead.

## Alternatives rejected

- **Four players, keep the original design.** Rejected: the product requirement
  is six-player co-op. This ADR exists precisely because that requirement
  conflicts with the source design.
- **Six humans, no bots.** Rejected: breaks solo and partial-party play entirely,
  and forces separate tuning for every player count from one to six.
- **Four combat slots plus two asymmetric support roles** (drone operator,
  fire-support controller). Rejected: creates a second-class player experience.
  Whoever gets the support slot is playing a different, lesser game.
