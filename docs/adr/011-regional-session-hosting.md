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
