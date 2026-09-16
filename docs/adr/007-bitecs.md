# ADR-007: bitECS for entity storage

- **Status:** Accepted
- **Date:** 2026-09-16
- **Plan reference:** §2, T-0.09

## Context

Network replication operates on components, not objects: a snapshot says "entity
7's Transform and Health changed" and a delta encodes only changed fields
(T-1.04). The entity storage layer should make that cheap rather than requiring a
translation step every tick.

## Decision

bitECS. Components are typed arrays; a component registry maps each component to
a stable numeric ID used directly in wire-format component masks.

## Consequences

- Component data is already in typed arrays, so snapshot serialization reads
  contiguous memory rather than walking an object graph. The ECS layout and the
  wire format are the same shape by construction.
- Stable numeric component IDs mean the wire format does not carry field names,
  which is a significant part of why ADR-009's budget is achievable.
- The API is unergonomic compared to object-oriented alternatives. Accepted.
- Entity IDs are recycled, so network identity (`NetId`) must be a separate
  component with its own allocation policy. T-0.09's test exists specifically to
  catch ID reuse collisions.

## Alternatives rejected

- **Miniplex.** Much nicer API. Rejected: stores objects, so every snapshot would
  require walking and copying rather than reading typed arrays directly.
- **Custom ECS.** Rejected: no meaningful advantage over bitECS, and it is
  infrastructure rather than game.
- **No ECS — plain entity classes.** Rejected: replication wants per-component
  change tracking. Without it, deltas degrade to whole-entity diffs and the
  bandwidth budget in ADR-012 is unreachable.
