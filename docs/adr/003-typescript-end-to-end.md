# ADR-003: TypeScript end to end

- **Status:** Accepted
- **Date:** 2026-09-16
- **Plan reference:** §2

## Context

An authoritative server must run the same simulation the client predicts. If the
two are written in different languages, every movement rule, weapon definition,
and collision response exists twice and must be kept in agreement by hand. That
divergence is a permanent source of prediction error and is very hard to test.

The client must run in a browser. That constrains the shared language to
something that compiles to JavaScript or WebAssembly.

## Decision

TypeScript, in strict mode, for client, server, shared simulation, tooling, and
test bots. The shared simulation lives in `packages/shared` and is imported
verbatim by both sides.

`packages/shared` may not import platform-specific modules — no `three`, no `ws`,
no `fs`, no `node:*`. Enforced by lint (T-0.03).

## Consequences

- One definition of movement, weapons, and damage. Client and server cannot drift
  by editing one and forgetting the other.
- Strict mode plus `noUncheckedIndexedAccess` is non-negotiable for netcode:
  buffer indexing errors are otherwise silent and produce corrupt state rather
  than a crash.
- TypeScript's numeric type is `number` (f64) throughout, which has determinism
  implications handled in ADR-014.
- Node and browser share an engine (V8) in the common case, which conceals
  cross-engine bugs during development. See ADR-014.
- Agents can work on any part of the stack without a language context switch,
  which matters given this project is built by agents task by task.

## Alternatives rejected

- **Rust compiled to WASM for the shared simulation.** Genuinely better on
  determinism and performance. Rejected on iteration speed: every gameplay tweak
  becomes a cross-language build, and the debugging story across the JS/WASM
  boundary is poor. Reconsider only if ADR-014's bounds prove unachievable.
- **C# with Godot.** Rejected: the server would need its own netcode stack, and
  the client/server shared-simulation property — the entire reason for this
  ADR — would be lost.
- **Plain JavaScript.** Rejected: bit-packed wire formats (ADR-009) and component
  registries depend on type discipline to be safe at all.
