# ADR-012: Authoritative server netcode shape

- **Status:** Accepted
- **Date:** 2026-09-16
- **Plan reference:** §2.1

## Context

A third-person shooter needs shooting to feel immediate and fair over a network
where the round trip is 40–200 ms. The standard solution set is well established;
the decisions here are which parts we adopt and with what parameters.

Note that because PvP is excluded (ADR-002), server authority is *not* primarily
an anti-cheat measure. It is chosen because it gives one unambiguous world state,
one owner for AI, and a single arbiter for hit resolution.

## Decision

- Authoritative server at a **fixed 30 Hz tick**.
- **Client-side prediction for local player movement only.** Nothing else is
  predicted.
- Remote entities **interpolated ~100 ms behind server time**.
- Hitscan resolved server-side with **lag compensation**: hitboxes rewound to the
  firing client's render time, rewind window capped at 200 ms.
- Delta-compressed snapshots against each client's last acknowledged tick.
- Interest management: ~120 m radius plus room culling.
- AI behavior at 10 Hz, AI locomotion at 30 Hz.

Bandwidth budget ~18 KB/s down per player. Any design exceeding 40 KB/s needs
review.

## Consequences

- 30 Hz is a deliberate trade: 60 Hz would halve input-to-effect latency but
  double bandwidth and server CPU. 30 Hz with prediction and interpolation is the
  genre norm and leaves headroom for the AI count this game needs.
- **Lag compensation makes "I was shot behind cover" structural, not a bug.**
  Someone is always wrong about the world; lag comp chooses to favor the shooter.
  The 200 ms cap bounds how wrong the victim can be. This is a design position
  and complaints about it are not defects.
- Predicting only local movement keeps the shared-simulation surface small, which
  is what makes ADR-014's narrow determinism scope possible. Predicting more —
  doors, damage, AI — would widen it substantially.
- Interpolating remote entities 100 ms behind means players never see live
  positions of others. This is invisible in play and is what makes remote motion
  smooth under jitter.
- Interest management is required, not an optimization: without it, bandwidth
  scales with world size rather than with what a player can see.

## Alternatives rejected

- **Lockstep / deterministic simulation.** Rejected: requires whole-world
  determinism (which ADR-014 explicitly avoids), and one slow client stalls
  everyone. Suited to RTS, not to a shooter.
- **Client-authoritative movement.** Rejected: no coherent world state, and
  reconciling two clients' disagreement has no principled answer.
- **60 Hz tick.** Rejected on cost against a marginal benefit given prediction is
  already hiding local latency. Revisit only if T-1.24 says the game feels sluggish
  and profiling points here.
- **Rollback netcode.** Rejected: excellent for small deterministic games, poor
  fit for six players plus forty AI, and it would impose the whole-world
  determinism requirement ADR-014 rejects.
