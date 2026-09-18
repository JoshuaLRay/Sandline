# ADR-011: Regional session-based hosting

- **Status:** Accepted
- **Date:** 2026-09-16
- **Plan reference:** §2, E-4.9

## Context

The server is authoritative (ADR-012), so every player's input round-trips
through it. Prediction hides local latency but not the latency of seeing other
players and AI. The target is under 80 ms RTT, which is a geography problem
before it is an engineering one.

Sessions are long-lived, stateful, and hold an entire simulation in memory.

## Decision

Session-based dedicated servers allocated per match, deployed to multiple
regions, with players matched into the region that minimizes worst-case RTT
across the party. Fly.io or Hathora as the initial platform.

## Consequences

- Hosting cost scales with concurrent sessions rather than players, and six
  players amortize one process. Cost must be modeled before launch (R7).
- A party spanning continents will have a bad time for at least one member. Match
  on worst-case rather than average RTT so the decision is explicit rather than
  emergent.
- Sessions are stateful and cannot be load-balanced mid-match. Session
  orchestration — allocation, health, drain, reclaim — is real work (E-4.9), not
  a deployment detail.
- Reconnect (T-1.09) must route a returning player back to their specific
  session, not merely to the service.

## Alternatives rejected

- **Peer-to-peer with host migration.** Rejected on three counts: the host gets a
  latency advantage, NAT traversal requires the TURN infrastructure ADR-008
  already declined, and a hostile host can trivially corrupt the session. Lower
  cost, but it moves the trust model the wrong way.
- **Single region.** Rejected: guarantees unacceptable latency for most of the
  world.
- **Serverless / edge functions.** Rejected: sessions are long-lived and
  stateful, which is the exact workload serverless is worst at.

---

## Addendum — 2026-09-18: one host first, and P2P is still rejected

M1.5 (PLAN.md §4.2, §6A) pulls a deployed host forward from M4 to immediately
after M1, so that two humans can play each other roughly thirty weeks earlier
than this plan originally had them doing so. Two clarifications, because the
request that prompted it used the words "peer to peer".

**The decision above is unchanged.** Authoritative dedicated hosts, allocated
per session. The rejection of peer-to-peer with host migration stands on all
three of its original counts — host latency advantage, NAT traversal requiring
TURN, and a hostile host able to corrupt the session. Two players connecting
"to each other" means connecting to each other *through* a host. That is not a
compromise made for M1.5; it is the only arrangement under which the shot
arbitration those playtests exist to judge means anything at all, since lag
compensation (T-1.18) is a server-side rewind and there is no server to rewind
in a P2P mesh.

**What M1.5 does take is a staging of this decision, not a departure from it.**
T-1.5.07 deploys *one* host in *one* region with no allocation, no orchestration
and no drain — the smallest thing that is still a dedicated authoritative
server. Multi-region placement, worst-case-RTT matching, session allocation and
reclaim remain E-4.9 and remain as specified here. The <80 ms RTT target is not
being tested by a single-region host and should not be claimed from it; what
T-1.5.08 measures is whether the netcode holds up at whatever latency two real
people happen to have between them, which is a different and, at this stage,
more urgent question.

**One thing this does raise.** A host process that any player can run now exists
as a by-product (T-1.5.01), and the in-page session already is a listen server
in all but name. Whether a player-run host is ever a *supported* mode — LAN
play, community servers — is not something this ADR ruled on, and it is now
PLAN.md §9 Q7, to be answered before E-4.9 rather than drifted into.
