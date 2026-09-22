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

Use **`@dimforge/rapier3d-deterministic-compat`**. Verify the exact published
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

## Addendum — 2026-09-17, package name verified

The name originally written here, `@dimforge/rapier3d-compat-deterministic`, does
not exist on npm. The published name reverses the last two segments:

**`@dimforge/rapier3d-deterministic-compat`** — 0.20.0 at time of pinning.

Dimforge publishes three orthogonal axes at the same version:

| Package | Solver | Loading |
|---|---|---|
| `@dimforge/rapier3d` | default | bundler |
| `@dimforge/rapier3d-compat` | default | async, works in Node |
| `@dimforge/rapier3d-simd[-compat]` | SIMD | either |
| `@dimforge/rapier3d-deterministic[-compat]` | deterministic | either |

This confirms the decision above: `-compat` is a loading-strategy suffix that
composes with the solver variant. We need both properties, so we take the
package carrying both suffixes.

## Addendum — 2026-09-17, performance cost measured

ADR-005 required measuring the deterministic build's cost rather than assuming
it negligible, and named the threshold for revisiting this decision. Measured
via `pnpm bench:rapier` at this game's scale — 46 dynamic capsules (6 players +
40 AI) on a static ground plane, 1800 steps, best of 3:

| Build | Per step | Relative |
|---|---|---|
| `-deterministic-compat` (our pick) | 8.4 µs | 1.00× |
| `-compat` (default) | 7.8 µs | 0.93× |
| `-simd-compat` | 6.8 µs | 0.81× |

**The deterministic build costs ~7% more than default and ~24% more than SIMD.**

Against a 33,333 µs server tick at 30 Hz, allowing physics a generous 25% of the
tick (8,333 µs), the deterministic build consumes **0.1% of that allowance**.

**Verdict: ADR-005 stands, with a wide margin.** The determinism guarantee is
effectively free at this scale. The trade would only become interesting at
roughly a thousand times more bodies than this game will ever have, at which
point the design would have other problems.

This also retires the contingency in the Consequences section above: no revisit
of ADR-005 or ADR-014 is needed before M1.

### Local determinism confirmed

`physics.test.ts` runs two independent worlds through identical 100- and
1000-step falls. Peak divergence: **exactly 0.0 m** in both.

That is *local* determinism only — one machine, one engine. The cross-engine
property this ADR actually buys is what the non-V8 CI job exists to verify, and
it remains unverified until that job runs.

## Addendum — 2026-09-19: the character controller does not use Rapier

T-1.12's world collision landed as a shared static world of axis-aligned boxes
resolved in pure arithmetic (`packages/shared/src/sim/world.ts`,
`CharacterController.ts`), not as Rapier's kinematic character controller.

The reason is §2.3's own: arithmetic and comparison are exactly specified by
IEEE-754, so a box world gives client and server bit-identical prediction on
every engine with no WASM in the prediction path, and the parity test can
assert zero rather than a bound. The deterministic Rapier build would have
given *bounded* agreement at the cost of a physics world on every client and
in every server room, for geometry that is nothing but boxes.

This does not reopen the decision above. Rapier remains the physics engine
for anything dynamic — debris, ragdolls, projectiles with real arcs — and the
`-deterministic-compat` build remains the one to use if any of that is ever
predicted. What the box world cannot express (slopes, stairs beyond a step,
round columns) is a level-design constraint accepted for M2's grey box; when
levels need it, replace the world representation and keep the controller's
contract: a pure function of (state, input, dt, config, world).


## Addendum — 2026-09-21: projectiles do not use Rapier either

The 2026-09-19 addendum above, while recording that the character controller
had left Rapier, named "projectiles with real arcs" among the things Rapier
remains the engine for. E-2.5's grenades and rockets are exactly that, so the
line is amended rather than worked around (§0.2: a locked decision is raised,
not silently substituted).

**Projectile flight, bouncing and blast occlusion are pure arithmetic over the
shared box world** (`packages/shared/src/sim/ballistics.ts`), on the same
`rayWorld` the shots and the camera arm use, now with an inflation radius that
turns a ray into a swept sphere.

Three reasons, in order of weight:

1. **The player aims by the arc they are shown.** A thrown grenade is the only
   thing in this game whose trajectory is drawn *before* it is committed to. If
   the preview and the authoritative flight come from different integrators
   they disagree visibly, in front of the person deciding where to throw — the
   two-sets-disagreeing failure `world.ts`'s header is about, in its most
   obvious form. One function stepping over one list cannot disagree with
   itself.
2. **It would put WASM in the preview path.** The preview runs in the render
   loop of every client, including the published static page. Rapier on the
   server and something else on the client is the disagreement above; Rapier on
   both is a physics world per client per session to fly one sphere.
3. **There is nothing here Rapier is better at.** Gravity, drag, a swept sphere
   against axis-aligned boxes, restitution and friction are about eighty lines
   of `+ - * /` and `Math.sqrt`, all exactly specified by IEEE-754. What a rigid
   body solver buys — stacking, joints, arbitrary convex shapes, contact
   manifolds — a grenade does not use.

**What is unchanged.** Rapier stays the engine for anything that needs a real
solver: ragdolls, debris, vehicles, and any dynamic body whose behaviour
nobody has to agree about in advance. `-deterministic-compat` remains the build
to use for it. §2.3 is also unchanged and is why this is a small decision:
projectiles are replicated, never predicted, so no parity obligation attaches
to them — the determinism above is a property this arithmetic has for free,
not a promise the netcode leans on.
