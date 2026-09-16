# ADR-009: Hand-rolled bit-packed wire format

- **Status:** Accepted
- **Date:** 2026-09-16
- **Plan reference:** §2, §2.1, T-1.01

## Context

The bandwidth budget in ADR-012 is roughly 18 KB/s down per player: about 50
relevant entities at ~12 bytes each, 30 times a second. Hitting 12 bytes per
entity requires controlling quantization per field — position at 1/64 m, angles
at 1/1024 turn, velocity at 1/32 m/s — and packing at the bit level rather than
the byte level.

## Decision

A hand-written `BitStream` reader/writer over `ArrayBuffer` (T-1.01), with
per-field quantization (T-1.02) and component serializers driven by the ADR-007
registry (T-1.03).

## Consequences

- Full control over the size/precision trade per field, which is the only way to
  reach the budget.
- **We own the correctness burden.** A serialization bug produces silently
  corrupt state rather than an exception, which is the worst failure mode in the
  system. This is why T-1.01 mandates property tests over 10,000 random
  round-trips per type, and why over-reading must throw rather than return
  garbage. These tests are not optional.
- Quantization becomes a source of client/server disagreement and must be
  accounted for in ADR-014's bounds.
- The integer angle representation is reused by the deterministic trig table
  (T-0.14). Changing angle resolution means regenerating that table — the two are
  coupled and the plan says so in both places.

## Alternatives rejected

- **JSON.** Rejected: roughly 10–20× the size, and no quantization control at all.
- **Protobuf / FlatBuffers.** Rejected: byte-aligned fields with no bit-level
  quantization, plus schema tooling in the build for a message set small enough
  to hand-write.
- **MessagePack.** Rejected for the same reason as protobuf — compact for
  general data, but it cannot express "this float is 11 bits over this range."
