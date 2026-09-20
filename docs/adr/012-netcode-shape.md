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

## Addendum — 2026-09-17, the 60 Hz question is closed

This ADR rejected a 60 Hz tick and named the condition for revisiting it: *"only
if T-1.24 says the game feels sluggish and profiling points here."*

Both halves were tested.

**Profiling** (`pnpm bench:tickrate`, 6 players, projected to a 46-entity
firefight) showed 60 Hz to be affordable — 1.91× CPU and 2.02× bandwidth, both
from a negligible base, both inside the 18 KB/s budget. So cost was never the
blocker.

**Feel** was the deciding half, and it came back unambiguous. First human QA of
the movement harness at 30 Hz: *"Movement feels great! No lag or jitter. No
delay at all. Feels like a Steam game."*

**Decision: 30 Hz stands. The question is closed, not deferred.**

One correction to the reasoning above, recorded because it was wrong rather than
merely incomplete. The Alternatives section justified rejecting 60 Hz on the
grounds that "prediction is already hiding local latency." That conflates two
different latencies: prediction hides *round-trip network* latency, and does
nothing about *input sampling quantization*, which is purely a function of tick
rate. The conclusion survives, but not for the reason originally given — it
survives because a human could not feel the 33 ms sampling window.

Reopen only on new felt evidence, not on analysis. The cost side is settled.

---

## Addendum: repeat-then-idle is replaced by hold-immediately (2026-09-18)

This ADR specified that a server missing an input should *repeat the last one*
for up to five ticks before treating the player as idle. That was the right call
when each input was sent once. It is the wrong call now that inputs are resent,
and it was measurably the largest remaining source of visible correction on a
poor link.

**Why repeating hurts.** Horizontal motion in the character controller is driven
directly by input rather than by carried momentum, so an *idle* step moves the
player almost nowhere, while a *repeated* step moves them a full tick's worth —
about 0.22 m at sprint — that the client never predicted. The client is then
yanked back by exactly that distance. Repeating manufactures divergence out of
nothing; holding manufactures none.

**What replaced it.** Three changes, in increasing order of effect, measured at
80 ms latency / 15 ms jitter / 5% loss with six bots:

| | peak divergence | corrections | unmatched reconciles |
|---|---|---|---|
| Before | 0.88 m | 33% | 98% |
| Reconciling without wiping history | 1.11 m | 19.5% | 8% |
| Resending the last 3 inputs | 1.11 m | 0.3% | 0.1% |
| Ignoring non-advancing acknowledgements | 0.23 m | 0.4% | 0% |
| Holding instead of repeating | **0.15 m** | **0.1%** | **0%** |

(The middle row's divergence rises because the client finally predicts instead
of snapping to authority thirty times a second. A large number there was hiding
behind a broken client that never diverged because it never predicted.)

**The trade, stated plainly.** A held character pauses for a tick on everyone
else's screen instead of gliding onward. This is deliberate and was asked for
explicitly: the person with the poor connection should feel smooth, and the
people watching them should absorb the jitter. It is the same asymmetry
lag compensation already makes in favouring the shooter, applied to movement.
A character that holds and then catches up is also more honest than one that
keeps running on a guess and is then teleported back.

**MAX_INPUT_REPEAT is retained but no longer used to repeat input.** It still
bounds `staleTicks`, which remains the signal for a client that has gone quiet.

Revisit if a future controller carries horizontal momentum, which would make a
held step and a repeated step much closer in effect and weaken the argument.

---

## Addendum: T-1.24 is run by one human, not two (2026-09-18)

T-1.24 is this ADR's gate — the task whose failure the plan says should send us
back here before M2 starts. It specified **two humans** playing at 0, 80 and
200 ms. It is being run by one, and the reason is not convenience.

**There is nowhere for a second human to join.** The QA home is GitHub Pages,
which is static hosting: no process runs there to connect to. The authoritative
session therefore runs *inside the tab*, reached over a loopback pair through
NetSim, and ADR-011's regional hosting is not deployed. A second person opening
the same URL gets their own separate session, not a seat in yours.

**What replaces the second human.** The in-page `SparringPartner` — a real
`NetClient` walking a seeded patrol — plus, added for this gate, an independent
set of link conditions per client. One slider driving every link could not
produce the case that matters most: a teammate lagging on a connection that is
otherwise fine. Your link governs prediction, reconciliation and the delay
between trigger and hit marker; theirs governs only what you see of them. Those
are different faults in different code, and a gate that cannot separate them
produces a verdict that cannot be acted on.

**What this genuinely does not answer, at any slider setting:**

- Real jitter distributions. NetSim draws uniform jitter around a mean; real
  networks are heavy-tailed.
- Reordering under congestion, and TCP head-of-line blocking.
- NAT traversal and connection establishment against a remote host.
- Two humans' inputs interacting — two people contesting the same doorway, or
  each shooting the other under lag compensation, which is precisely the case
  "a corpse takes no further damage" exists to handle.

The last one is the real loss. Everything else on that list is a property of
the transport; that one is a property of *gameplay under lag* and the bot cannot
stand in for it, because it never shoots.

**Consequence: a passing T-1.24 does not close R2.** It answers "does an
authoritative-server TPS feel good in a browser" for one player against a
simulated link, which is the question worth answering before content
investment. It does not answer "does it feel fair when two people shoot each
other across 200 ms". That needs a real host, and it should be re-gated when
E-4.9 deploys one — not quietly assumed to have been covered here.

**Re-gated 2026-09-18, at M1.5 rather than E-4.9.** The paragraph above says
this needs a real host and should be re-gated when one is deployed. Rather than
wait for E-4.9 in M4, the host moved: PLAN.md §4.2 inserts M1.5 directly after
M1, and T-1.5.08 is the gate that closes this addendum. It carries the same
stop rule as T-1.24 — if two humans shooting each other across a real link does
not feel fair, come back here before M2 continues. R2 closes there, not at
T-1.24.

## Addendum: the two-human gate passed; the conclusion stands (2026-09-20)

T-1.5.08 was run on 2026-09-19: two people on different networks, joined
through the published lobby to the Fly host, conditioning off. The owner's
verdict is a pass — "it looks great" — recorded in `docs/playtests/m1.5.md`,
with the LAN run before it in `docs/playtests/m1.5-lan.md`. The stop rule the
re-gate paragraph above carries was not triggered. **This ADR's conclusion is
unchanged by the two-human case**, and the re-gate addendum of 2026-09-18 is
closed. R2 is closed with it (PLAN.md §8).

One thing the gate owed and did not deliver: the measured RTT, jitter and
correction numbers beside the verdict, which are what would let NetSim's
uniform-jitter model be checked against a real route. The playtest file says
so. Until a session records them, the T-1.22 cells stand on the model alone.

