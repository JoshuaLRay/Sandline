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

## Addendum — 2026-09-26: every bot has a human in command (U-025)

Owner decision (feedback 2026-09-26, [U-025](../backlog/U-025.md)): every bot
has a human "in command" of it. At the campaign's start every bot is under the
human in the lowest-numbered occupied slot; any seated human may hand any bot
to any seated human, themselves included; when a commander leaves, their bots
(and the slot they hand back) go to the lowest-numbered human left. Bots
cannot go on without a human in command, so a started session with nobody
seated **pauses** — its clock stops — until someone returns. A session nobody
has ever been seated in (the headless scenarios and tests) runs as before.

What this does not change: **any player may still issue orders to any bot**
(within T-4.27's class rules); command is who a bot answers to, not who may
order it. Whether it should also gate orders is an open owner decision, not
made here. The six slots, possession on join and hand-back on leave stand.
U-026 (switching into a commanded bot) revisits the consequence above that
hot-swapping is replaced by orders; that is its decision to record.

## Addendum — 2026-09-26: switching into a commanded bot (U-026)

Owner decision (feedback 2026-09-26, confirmed when U-026 was taken up, with
this addendum's reversal named): "a player should also be able to switch the
character they are currently playing as, provided the selected character is a
bot they command." This **reverses** the consequence above that
hot-swapping is replaced by issuing orders. A player may take control of any
bot they command (U-025); the soldier they leave becomes a bot under their
command, the one they take stops being one. Only the controller moves — the
connection, its reconnect claim and its player identity. Both soldiers keep
everything they are (position, health, weapon and magazine, pouch, class,
campaign soldier), and the six-slot squad, possession on join and hand-back on
leave all stand. A bot another player commands, a human's soldier, and a
dropped player's held seat cannot be taken.

## Addendum — 2026-09-27: six named characters (U-019)

Owner direction (feedback 2026-09-26): "the squad will be 6 unique, named
characters, that each have their own set of weapons/skills. 2 of the
characters will have snipers, 1 an LMG, 1 an AR, 1 a scoped AR, and the final
will be a support role that can't ads (or fps) that will be able to hold 2
primaries — smg and shotgun, run a bit faster." This direction is accepted.
It supersedes, when implemented, T-4.27's two-class slice (Team Leader,
Marksman) as the squad's loadouts. A character belongs to a slot, so
everything above about slots — six always, possession on join, hand-back on
leave, a slot keeping its soldier, command (U-025) and switching (U-026) — is
unchanged and carries the character with it. The names, skills, exact weapons,
the support's speed and pistol, and its two-primary controls are **not
decided**: they are proposals in `docs/design/squad-roster.md` awaiting the
owner, and a further addendum records them when decided.
