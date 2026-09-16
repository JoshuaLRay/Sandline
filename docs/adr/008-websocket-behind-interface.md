# ADR-008: WebSocket behind a transport interface

- **Status:** Accepted
- **Date:** 2026-09-16
- **Plan reference:** §2, T-1.06

## Context

A 30 Hz action game ideally wants unreliable, unordered delivery: a snapshot that
arrives late is worthless, and blocking newer snapshots behind it is actively
harmful. The browser options are:

- **WebSocket** — TCP. Reliable, ordered, head-of-line blocking. Trivial to
  deploy.
- **WebTransport** — HTTP/3, offers unreliable datagrams. Safari support is the
  open question.
- **WebRTC DataChannel** — UDP-like, but requires signaling infrastructure and
  TURN relays for restrictive NATs.

## Decision

WebSocket now (uWebSockets.js on the server), **behind a transport interface**
exposing `reliable` and `unreliable` channels. Both channels map to TCP for the
moment. All game code targets the interface; nothing imports a WebSocket type.

## Consequences

- Deployment is trivial and the failure modes are well understood, which is the
  right trade while M1 is answering a harder question.
- Head-of-line blocking is real but tolerable: at 30 Hz with ~18 KB/s payloads on
  a co-op PvE game, a stalled snapshot costs a frame of interpolation, not a
  lost duel.
- **The danger is assumption leakage.** Because TCP delivers everything in order,
  it is easy to write code that quietly depends on it — assuming every snapshot
  arrives, that ticks are contiguous, that acks never gap. Such code cannot later
  move to an unreliable transport. T-1.21's loss injection exists partly to
  surface these assumptions early, and every netcode test runs with loss enabled.
- The `unreliable` channel is a real part of the API today even though it is a
  lie today. Code written against it will be correct when it stops being one.

## Alternatives rejected

- **WebTransport now.** Rejected on Safari support uncertainty. Revisit at M4;
  the interface exists to make that a contained change.
- **WebRTC DataChannel.** Rejected: signaling and TURN are meaningful
  infrastructure and cost, for a latency benefit that M1 has not yet shown we
  need.
- **No abstraction, WebSocket directly.** Rejected: guarantees the assumption
  leakage above becomes permanent.
