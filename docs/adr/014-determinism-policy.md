# ADR-014: Determinism policy

- **Status:** Accepted
- **Date:** 2026-09-16
- **Plan reference:** §2.3

> This is the ADR most likely to be violated by accident. Read it before writing
> any test that compares client state to server state.

## Context

The original plan called for a whole-world determinism guard: a 1000-tick golden
hash over all replicated component data, asserted to match a committed value.
External review identified this as wrong on two independent counts.

**First, it is unnecessary.** Snapshot replication does not require whole-world
determinism. The server is authoritative and ships state; clients apply it.
Clients do not reproduce the server's simulation — they receive it.

**Second, it is actively harmful.** A whole-world hash breaks on every damage or
movement tuning change. The team learns to re-baseline it reflexively. At that
point the test catches nothing while still costing time — it has become a ritual.

Review also identified a concrete determinism hazard the plan had missed:
ECMAScript does not specify transcendental functions to bit precision.

## Decision

### Scope

Only two code paths require client/server parity:

1. **The character controller** — the local player is predicted and reconciled
   (ADR-012, T-1.12, T-1.15).
2. **Weapon spread** — and only if the client draws *predicted* tracers. Spawn
   tracers from the server hit event instead and even this is exempt. Decide this
   before implementing T-1.17.

Everything else — damage, AI, ragdolls, debris, vehicles, destruction — is
replicated, never predicted, and **may diverge freely**.

### Parity is bounded, not bit-exact

Tests assert divergence under an epsilon and **log the actual number**. The
logged trend is the early warning. A hard equality assertion on a
floating-point physics path is a tripwire that gets disabled the first time it
fires.

Bit-exact assertions remain correct on integer and table-driven paths — clock
tick counts, wire-format round trips, trig table output, seeded PRNG sequences —
because those are exact by construction. The distinction is not "how strict do we
feel"; it is whether the code path can actually deliver exactness.

### Parity tests own their constants

A parity test must declare its movement and weapon constants **in its own
fixture**, never reading `data/*.json`. This is what decouples it from gameplay
tuning and is the specific fix for the failure mode above.

### Banned in `packages/shared`

`Math.sin`, `cos`, `tan`, `atan`, `atan2`, `exp`, `log`, `pow`, `hypot`,
`random`. Lint-enforced (T-0.14). Use the table trig and seeded PRNG in
`shared/math`.

`Math.sqrt` and the arithmetic operators **are** exactly specified by IEEE-754.
Do not reimplement them — over-correcting here adds risk for nothing.

## Consequences

- **The transcendental trap is the dangerous one.** The server is Node (V8) and
  Chrome is V8, so a `Math.cos` in the character controller produces *identical*
  results throughout development and diverges only for Safari (JSC) and Firefox
  (SpiderMonkey) players. It presents as unreproducible rubber-banding affecting
  some users. CI **must** run at least one non-V8 engine or nothing in this plan
  can detect it.
- T-0.11 is a parity *harness*, not a golden-value test. It reports divergence;
  callers assert bounds.
- T-1.20 and T-1.22 assert bounded prediction divergence and correction rate, not
  hash equality between bot clients.
- Narrow scope is what keeps the deterministic-physics requirement (ADR-005)
  affordable: only the character controller path needs it.
- Accepting divergence in AI and damage means those systems can use whatever is
  fastest server-side, including `Math.random` and native trig.

## Alternatives rejected

- **Whole-world golden hash.** Rejected as described above. Recorded as risk R10
  so the reasoning survives.
- **Bit-exact parity on the character controller.** Rejected: reconciliation
  smooths residual error anyway (T-1.15), so exactness buys nothing a bound does
  not, while being fragile against Rapier version changes.
- **Polynomial approximations for trig.** Rejected in favor of a table: angles are
  already quantized to integers at 1/1024 turn for the wire format (ADR-009), so
  a table indexed by that integer is exact rather than approximate, and cheaper.
