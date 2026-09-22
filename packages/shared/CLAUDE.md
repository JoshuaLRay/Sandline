# packages/shared — determinism constraints

This code runs headless in Node (the authoritative server, V8) **and** in
whatever browser engine a client happens to be (Safari/JSC, Firefox/
SpiderMonkey, Chrome/V8). A bug that breaks cross-engine agreement is
invisible in every Node-vs-Chrome test you'll ever run, and only shows up as a
Safari or Firefox player quietly diverging from the server. See
[ADR-014](../../docs/adr/014-determinism-policy.md) and §2.3 of `PLAN.md`.

- **No `Math.sin`/`cos`/`tan`/`atan`/`atan2`/`exp`/`log`/`pow`/`hypot`.** Not
  bit-specified by ECMAScript; results differ across engines. Lint enforces
  this. Use the table-trig helpers in `src/math`. `Math.sqrt` and the
  arithmetic operators are exactly IEEE-754 specified — those are fine.
- **No `Math.random`.** Use the seeded PRNG in `src/math`, seeded from
  tick + entity id so replays and both sides of the wire agree.
- **No platform imports.** No `three`, no `ws`, no `node:*`/`fs`. This is what
  lets the same simulation code run on the server and in the browser at all.
- **No wall-clock reads.** Nothing in here calls `Date.now()`/`performance.now()`
  to drive simulation state. Time comes in as a tick or a `dt` argument.
- **Bounded parity, not bit-equality.** Client/server agreement is asserted as
  divergence under an epsilon, logged every run — never a hash or an exact
  equality check. An equality assertion here is a tripwire that gets disabled
  the first time it fires (see R10 in `PLAN.md` §8). Only two things need this
  parity at all: the character controller and (conditionally) weapon spread —
  see §2.3.
- **Tuning values live in JSON, validated by zod.** Weapons, classes, enemy
  archetypes, damage — never hardcoded constants in a system. Parity test
  fixtures are the one exception: they own their own constants rather than
  reading `data/*.json`, so gameplay tuning can never break a parity test.
- **Tests ship with the code.** Every new piece of logic here needs a unit
  test; anything touching netcode needs a headless integration test.
