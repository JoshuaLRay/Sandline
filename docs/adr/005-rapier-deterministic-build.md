# ADR-005: Rapier deterministic build

- **Status:** Accepted
- **Date:** 2026-09-16
- **Plan reference:** §2, §2.3
- **Supersedes:** the initial choice of the default `rapier3d-compat` build

## Context

The character controller runs on both client and server (ADR-003) because the
local player is predicted and reconciled (ADR-012). The two sides must agree
closely enough that corrections are imperceptible.

The original plan specified `@dimforge/rapier3d-compat`. External review
established that this is wrong: Dimforge's own documentation states that the
default build guarantees only **local** determinism — identical results on the
same machine — and that cross-platform determinism is provided by the separate
`-deterministic` build variants, which disable SIMD and the parallel solver.

A second finding, frequently confused with the first: `compat` versus
non-`compat` is about **WASM loading strategy**, not determinism. The `compat`
build bundles the WASM for async loading, which is what allows the same module to
initialize in Node and in the browser.

## Decision

Use **`@dimforge/rapier3d-compat-deterministic`**. Verify the exact published
package name at pin time rather than trusting this document.

**Do not attempt to fix determinism by dropping `compat`.** The two axes are
orthogonal. Dropping `compat` removes Node loading, which breaks the shared
simulation the entire architecture rests on, and gains nothing.

## Consequences

- No SIMD and no parallel solver. Accepted: at this project's scale — six players
  plus roughly forty AI, not thousands of rigid bodies — the cost is expected to
  be irrelevant. **T-0.10 must measure it rather than assume it.**
- If the measured cost is material, this ADR and ADR-014 must both be revisited
  *before* M1 begins, not after content depends on them.
- The tight bound asserted by T-1.22 is only meaningful because of this choice.
  With the default build, the correct assertion would be much looser.

## Alternatives rejected

- **Default build plus a wider reconciliation tolerance.** A genuine fallback if
  the deterministic build's performance cost proves real. Rejected as the default
  because it trades a known small cost for an unknown quality cost — more
  frequent visible corrections — that is far harder to measure.
- **Custom fixed-point physics.** Rejected: enormous effort, and it solves a
  problem we do not have. We need bounded agreement, not bit-exactness (ADR-014).
- **Jolt or Havok via WASM.** Rejected: less mature JavaScript bindings and no
  equivalent determinism story.
