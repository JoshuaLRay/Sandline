# ADR-026: Two C4 detonators — oldest charge on right click, all charges on R

- **Status:** Accepted
- **Date:** 2026-10-16
- **Plan reference:** P4 in [VISION.md](../VISION.md); U-054 (C4), D-11 in [squad-roster.md](../design/squad-roster.md); [U-182](../backlog/U-182.md)

## Context

C4 (U-054) is placed on a surface (thrown by the support) and set off by its
owner. Owner decision D-11 (2026-09-30) made right click with the charges in
hand the detonator for **every** charge out at once. That leaves no way to
blow one charge and keep the next for a second target, a second door or a
pursuing enemy.

On 2026-10-16 the owner approved two detonation methods:

1. the existing mouse-click detonation sets off **the earliest-placed active
   charge**, individually, in placement order (FIFO); each activation sets off
   the next oldest; with none out nothing happens;
2. **R** sets off **all** active charges the player controls at once.

R is already reload. With C4 in hand there is nothing to reload, so R is free
there; with a gun in hand it must stay reload.

## Decision

1. **Right click** with placed charges in hand sets off the oldest armed charge
   of that kind the soldier has out, and only it. One press is one charge:
   holding the button does not repeat.
2. **R** with placed charges in hand sets off every armed charge of that kind
   the soldier has out, in the same tick. With anything else in hand R is
   reload, exactly as before. If both are pressed on one tick, R wins and
   nothing goes off twice.
3. **Order** is placement order: projectile net ids only grow, and a
   checkpoint restores placed charges in that order, so "oldest" is the same
   on the host, after a retry and on every run. A charge still in the air (the
   support's throw) is not armed until it sticks. A charge taken back with E,
   expired, or already detonated is not out, so the next press reaches the
   next one.
4. **Ownership** is the soldier's (`ownerNetId`), judged by the host. A press
   can only reach the presser's own soldier's charges; another player's,
   including those of a bot someone else commands, are never reachable. A
   player who switches into a soldier (U-026) takes over that soldier's
   charges, as they take over its rifle.
5. **Authority** is unchanged: the client sends held buttons on the input
   frame (`cook` for right click, new `detonateAll` for R, bit 8 of the
   16-bit field); the host detects the press, sets the charges off and resolves
   blast, cover, friendly fire and damage exactly as before. A spent charge is
   consumed; nothing returns to the pouch. `PROTOCOL_VERSION` 74.
6. **Same rule for every placed charge kind.** The detonators act on the kind
   in hand; today that is C4, and the claymore's manual detonation (which used
   the same path) follows the same two rules. The motion sensor never goes
   off.
7. **Bots** keep the all-at-once detonator for their armour attack (U-079):
   they wait until the squad is clear and set everything off together. The
   single-charge detonator is available to the host for the planned
   plant-and-detonate order, which chooses between them
   (U-198, queued with the 2026-10-16 backlog expansion).
8. **Controls are text, not yet rebindable.** The key list and the hint shown
   when charges are drawn name both detonators. When rebinding arrives
   (settings note "Shown, not yet rebindable"), "detonate all" is its own
   action whose default shares R with reload, contextual on what is in hand.

## Consequences

- A player can chain demolitions: place three, blow them one at a time as a
  patrol walks the line, or blow them all with R.
- This supersedes the "detonate all at once" part of D-11; the rest of D-11
  (two charges, 250 damage, 4 m, friendly fire as the frag, E takes your own
  back) stands.
- R is now contextual. A player holding C4 who presses R expecting a reload
  gets a detonation; the hint on drawing C4 says so.

## Alternatives rejected

- **A separate detonate-all key.** Rejected: the owner chose R, and with C4 in
  hand R had no use.
- **Nearest-first or look-at targeting.** Rejected: not what the owner asked;
  placement order is predictable and identical for every client and a bot.
- **Detonate by range from the soldier.** Rejected for the same reason.
