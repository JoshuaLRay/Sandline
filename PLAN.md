# SANDLINE — Browser Co-op Squad Shooter

**Project plan & agent-executable task backlog**

A browser-based, 6-player co-op third-person squad shooter in the spirit of
early-2000s console squad tactics games. Original IP — no licensed names,
characters, or assets.

> `SANDLINE` is a placeholder codename. Rename before any public artifact.

> **Revision 2.** Incorporates external technical review: determinism scoping
> (§2.3), the Rapier build correction (ADR-005), deterministic trig (T-0.14),
> and the vertical-slice scope cut (§4.1).

---

## 0. How to use this document

This plan is written to be executed by AI coding agents, one task at a time.

### 0.1 Task anatomy

Every leaf task has a stable ID (`T-<milestone>.<n>`), explicit file paths,
declared dependencies, and **acceptance criteria that a machine can check**.
If a task's "Done when" cannot be verified by running a command, it is not
ready to hand to an agent — break it down further first.

| Field | Meaning |
|---|---|
| **Depends** | Task IDs that must be merged first. `—` means it can start now. |
| **Files** | Paths the task owns. Agents should not edit outside these without noting why. |
| **Do** | The scope, in imperative form. |
| **Done when** | Verifiable exit criteria. Prefer a command that exits 0. |
| **Size** | `S` ≈ <150 LOC · `M` ≈ 150–400 LOC · `L` ≈ 400–800 LOC. Anything above `L` must be split. |

### 0.2 Markers

- 🧍 **Human sign-off required.** The task's real acceptance criterion is *feel*
  (netcode responsiveness, camera, animation, audio). An agent can make it
  compile and pass tests but cannot judge whether it is good. A human plays it
  and signs off.
- 🔒 **Locked decision.** Governed by an ADR in `docs/adr/`. Agents must not
  re-litigate; if the decision looks wrong, stop and raise it, don't silently
  substitute.
- ⚠️ **Risk spike.** Exists to de-risk an unknown. Failure is an acceptable and
  informative outcome — write up what was learned.

### 0.3 Standing rules for every task

1. **The repo stays green.** `pnpm verify` (typecheck + lint + test) must pass
   before the task is considered done. No task lands red.
2. **Tests ship with the code.** New logic in `packages/shared` requires unit
   tests. Netcode changes require a headless integration test (see T-1.20).
3. **No new runtime dependency** without a line in `docs/adr/`. Dev deps are free.
4. **Data over code.** Weapons, classes, and enemy archetypes are JSON validated
   by zod schemas, never hardcoded in systems.
5. **`shared` imports nothing platform-specific.** No `three`, no `ws`, no `fs`.
   It must run headless in Node and in the browser, byte-identically. This is
   what makes the authoritative server possible — enforced by T-0.11.
6. **Leave a trail.** Each task appends a one-line entry to `docs/CHANGELOG.md`.

### 0.4 Agent prompt template

```
Read sandline/PLAN.md. Implement task <ID> exactly as specified — its scope,
its file list, and its acceptance criteria. Do not implement adjacent tasks.

Before you start: read docs/adr/ for locked decisions and read the files
listed under Depends to match existing patterns.

When done: run `pnpm verify`, confirm the "Done when" criteria explicitly,
append your CHANGELOG line, and commit as `<ID>: <short description>`.

If the task is underspecified or you believe the spec is wrong, stop and
report rather than guessing.
```

### 0.5 Planning horizon

M0 and M1 are broken out to leaf tasks. **M2 onward are epics on purpose.**
Detail written now for work that starts in six months would be fiction —
those milestones get broken out at the milestone-planning gate, informed by
what M1 actually taught us. Treat the epic-level estimates as order of
magnitude, not commitments.

---

## 1. Product definition 🔒

### 1.1 The pillar and the problem

The source genre's core loop is *one player commanding three AI squadmates,
hot-swapping between them*. Six human players destroys that pillar outright —
the command layer goes vestigial and hot-swap becomes meaningless.

### 1.2 The resolution: six slots, AI backfill 🔒 (ADR-001)

The squad is **always six soldiers**. Unfilled slots are bots that any player
can issue orders to. This is the load-bearing decision of the entire project:

- Content is designed and tuned **once**. 1 player (5 bots) and 6 players
  (0 bots) run identical missions.
- Drop-in/drop-out is a bot↔human swap on a live entity — not a session rebuild.
- The tactical command layer survives at every player count.
- Encounters scale on *human* count, not squad size.

Missions are built for a six-man element that **splits into two three-man
fireteams** (overwatch + assault). Objectives expose two viable approach routes.

### 1.3 Classes

| Class | Role |
|---|---|
| Team Leader | Assault rifle, order authority, target marking |
| Heavy Weapons | LMG/RPG, suppression, anti-vehicle |
| Marksman | Long-range precision, spotting |
| Engineer | Demolitions, mines, breaching, vehicle repair |
| Medic | Fast revive, stims |
| Recon | Suppressed weapons, optics, fire-support calls |

**The vertical slice ships two of these: Team Leader and Marksman** (§4.1). That
pair demonstrates the overwatch/assault split the entire mission template rests
on. The other four are post-slice. Revive is available to every class — the
Medic is merely faster — so downed/revive still ships in the slice without
the Medic existing yet.

### 1.4 Retained mechanics

Downed-and-revive instead of instant death · per-soldier persistent XP across
the campaign · specialist-gated objectives · mounted and driveable vehicles ·
order wheel (move / attack / hold / regroup / context actions).

### 1.5 Explicitly out of scope for v1 🔒 (ADR-002)

Mobile and tablet · PvP · prone stance · destructible environments · voice chat
(ping + order wheel instead; players use Discord) · modding/UGC · controller
support beyond basic gamepad mapping.

---

## 2. Technical decisions 🔒

TypeScript end to end. The decisive constraint is running **the same simulation
code on client and server** — every stack choice serves that.

| Layer | Choice | ADR | Rationale |
|---|---|---|---|
| Language | TypeScript (strict) | ADR-003 | Shared sim across client/server |
| Render | Three.js | ADR-004 | Control + ecosystem; PlayCanvas rejected (editor lock-in) |
| Physics | Rapier, **deterministic build** (`@dimforge/rapier3d-compat-deterministic`) | ADR-005 | Same WASM in Node and browser. The default build guarantees only *local* determinism — see §2.3 |
| Navigation | `recast-navigation-js` | ADR-006 | WASM Recast/Detour |
| ECS | bitECS | ADR-007 | Typed arrays map directly onto network snapshots |
| Transport | WebSocket (uWebSockets.js) behind an interface | ADR-008 | WebTransport swaps in later; Safari support is the blocker |
| Wire format | Hand-rolled bit-packed binary | ADR-009 | Need quantization control; JSON/protobuf too costly |
| Build | Vite + pnpm workspaces | ADR-010 | |
| Hosting | Fly.io or Hathora, regional | ADR-011 | Session-based, target <80ms RTT |

### 2.1 Netcode shape 🔒 (ADR-012)

- Authoritative server, **30 Hz fixed tick**
- Client-side prediction for **local player movement only**
- Remote entities interpolated ~100 ms behind server time
- Hitscan resolved server-side with **lag compensation**: rewind hitboxes to the
  firing client's render time, rewind window capped at 200 ms
- Delta-compressed snapshots against each client's last ack
- Interest management: ~120 m radius + room culling
- AI behavior at 10 Hz, AI locomotion at 30 Hz

Bandwidth budget: ~50 relevant entities × ~12 B × 30 Hz ≈ **18 KB/s** down per
player. Any design that exceeds 40 KB/s needs review.

### 2.2 Performance budget 🔒 (ADR-013)

Target **60 fps at 1080p on 2020-era laptop integrated graphics**.

- <300 draw calls/frame — instanced props, per-family material atlases
- 8–15k tris and 45–65 bones per character, GPU skinning
- Baked lightmaps for static geometry + one cascaded shadow-mapped sun. No
  realtime GI — baked sun and dust haze *is* the target aesthetic
- KTX2/Basis textures, Draco/meshopt geometry
- Initial download <80 MB, playable in <30 s, levels streamed after

### 2.3 Determinism policy 🔒 (ADR-014)

**Snapshot replication does not require whole-world determinism.** The server is
authoritative and ships state; clients apply it. Only two code paths need
client/server parity:

1. **The character controller** — the local player is predicted and reconciled
   (T-1.12, T-1.15).
2. **Weapon spread** — and only if the client draws *predicted* tracers. Spawn
   tracers from the server hit event instead and even this is exempt.

Everything else — damage, AI, ragdolls, debris, vehicles — is replicated, never
predicted, and may diverge freely.

This scoping is deliberate. A whole-world golden hash breaks on every damage or
movement tuning change, teaches the team to re-baseline reflexively, and then
catches nothing. **Parity tests must own their constants in the test fixture**
rather than reading `data/*.json`, so gameplay tuning can never touch them.

**Parity is bounded, not bit-exact.** Reconciliation smooths residual error
anyway (T-1.15), so tests assert divergence under an epsilon and *log the actual
number*. The logged trend is the early warning; a hard equality assertion is a
tripwire that gets disabled.

#### Known determinism hazards in JavaScript

- `Math.sin`, `cos`, `tan`, `atan`, `atan2`, `exp`, `log`, `pow`, `hypot` are
  **not** specified to bit precision by ECMAScript. Results differ across
  engines. Banned in `packages/shared` — see T-0.14.
- **The trap:** the server is Node (V8) and Chrome is V8, so this bug is
  *invisible during development* and surfaces only for Safari (JSC) and Firefox
  (SpiderMonkey) players. CI must run at least one non-V8 engine.
- `Math.sqrt` and the arithmetic operators **are** exactly specified by
  IEEE-754. Do not reimplement them.
- `Math.random` is banned outright in simulation code; use the seeded PRNG.

---

## 3. Repository architecture

Task file paths below are relative to the `sandline/` project root.

```
sandline/
├── package.json                 # pnpm workspace root; `pnpm verify` lives here
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── PLAN.md
├── docs/
│   ├── adr/                     # locked decisions, one file per ADR
│   ├── CHANGELOG.md
│   └── tasks/                   # optional per-task expanded briefs
├── packages/
│   ├── shared/                  # platform-agnostic simulation — the core
│   │   └── src/
│   │       ├── ecs/             # world, component registry, queries
│   │       ├── sim/             # fixed timestep, character controller, weapons, damage
│   │       ├── net/             # bitstream, snapshot, delta, protocol, transport iface
│   │       ├── ai/              # behavior tree runtime, blackboard
│   │       ├── data/            # weapon/class/enemy defs (JSON + zod schemas)
│   │       └── math/
│   ├── server/                  # authoritative host
│   │   └── src/
│   │       ├── session/         # room, tick loop, player slots, bot backfill
│   │       ├── net/             # ws transport, lag compensation
│   │       └── ai/              # AI director
│   ├── client/                  # renderer, input, UI, audio
│   │   └── src/
│   │       ├── render/
│   │       ├── input/
│   │       ├── net/             # prediction, reconciliation, interpolation
│   │       ├── ui/
│   │       └── audio/
│   ├── bot/                     # headless test client — drives inputs, no renderer
│   └── tools/                   # asset pipeline, navmesh bake, level compiler
└── .github/workflows/ci.yml
```

**Why `packages/bot` exists and matters:** it is the single highest-leverage
thing in this plan for AI-driven development. A headless client that programmatically
drives inputs turns "does multiplayer work?" from a human judgement call into a
CI assertion. Agents cannot verify feel, but they *can* verify that two bot
clients converge on identical world state. Build it early (T-1.20).

---

## 4. Milestones

| ID | Milestone | Exit gate | Est. (solo, part-time) |
|---|---|---|---|
| **M0** | Foundations | `pnpm verify` green in CI; headless sim steps 1000 deterministic ticks | 2–3 wks |
| **M1** | ⚠️ Netcode prototype | 2 players, capsules, one hitscan rifle, 5 dumb enemies, playable at 120 ms simulated latency | 6–8 wks |
| **M2** | Shooter feel | 🧍 Third-person combat that a human signs off as good | 8–10 wks |
| **M3** | AI & squad command | 6 slots with bot backfill; enemies use cover and suppress | 10–12 wks |
| **M4** | Content systems | Asset pipeline, level format, mission scripting, lobby, saves | 10–12 wks |
| **M5** | Vertical slice | One finished 10-minute mission, 6 players, demo-able | 8–10 wks |

**M0 + M1 are the real gate.** Build zero content until the netcode prototype
feels good under simulated adverse network conditions. If M1 fails, the project
changes shape — that is exactly what the gate is for.

### 4.1 Estimate reality and the slice scope cut 🔒 (ADR-015)

**The table above sums to ~50 weeks. Treat that as a floor and plan for 3–5×.**
Solo part-time game projects overrun by roughly that factor with high
reliability, and these per-milestone figures exclude integration, debugging, and
the gap between "the art pipeline works" and "the art exists." The honest range
for the vertical slice as originally specced is **two to four years part-time**.

That is a scope problem, not an estimation problem. The response is to cut what
the slice has to *contain*, not to re-estimate what it takes to build:

| Originally specced | Vertical slice ships | Why |
|---|---|---|
| 6 classes | **2** — Team Leader, Marksman | Demonstrates the two-fireteam split |
| 5 enemy archetypes | **2** — rifleman, MG | The MG creates the suppression problem the marksman answers |
| 80–120 animation clips | **~35** | One weapon class per soldier class; 2 death variants not 6; vault cut |
| 60-piece modular kit | **~25** | One compact level, not six |
| Driveable vehicles | **Mounted MG only** | Driveable deferred past the slice |

**The 6-slot squad architecture (ADR-001) is not cut.** Six slots filled from a
two-class pool costs nothing extra and is precisely the thesis being
demonstrated. What gets cut is *variety*, not *structure* — that distinction is
what keeps the slice honest rather than merely small.

The netcode demo is what proves this project is possible. Content breadth proves
nothing that a collaborator, a publisher, or a playtester cares about at this
stage, and it is the single largest cost in the plan (R1).

M2–M4 estimates stay as written because they are mostly systems work, which the
cut does not touch. M5 shrinks. The 3–5× multiplier applies to all of them.

---

## 5. M0 — Foundations

Goal: a monorepo where shared simulation code runs identically and
deterministically in Node and the browser, verified in CI.

#### T-0.01 — Workspace scaffold
- **Depends:** —
- **Files:** `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.npmrc`
- **Do:** pnpm workspace with the five packages from §3 (empty `src/index.ts` each). Root scripts: `build`, `test`, `lint`, `typecheck`, and `verify` running all four.
- **Done when:** `pnpm install && pnpm verify` exits 0 on a clean clone.
- **Size:** S

#### T-0.02 — TypeScript configuration
- **Depends:** T-0.01
- **Files:** `tsconfig.base.json`, `packages/*/tsconfig.json`
- **Do:** Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, ES2022 target, project references. `shared` must build to both ESM and a Node-consumable form.
- **Done when:** `pnpm typecheck` exits 0; `client` and `server` can both import a symbol from `shared`.
- **Size:** S

#### T-0.03 — Lint and format
- **Depends:** T-0.01
- **Files:** `eslint.config.js`, `.prettierrc`
- **Do:** ESLint flat config + Prettier. Add a rule banning `three`, `ws`, `fs`, `node:*` imports inside `packages/shared`.
- **Done when:** `pnpm lint` exits 0; adding `import * as THREE from 'three'` to a shared file fails lint.
- **Size:** S

#### T-0.04 — Test harness
- **Depends:** T-0.02
- **Files:** `vitest.config.ts`, `packages/*/vitest.config.ts`
- **Do:** Vitest with workspace support, coverage reporting, and a `node` environment for `shared`/`server`, `jsdom` for `client`.
- **Done when:** `pnpm test` runs and reports a passing smoke test in each package.
- **Size:** S

#### T-0.05 — CI pipeline
- **Depends:** T-0.03, T-0.04
- **Files:** `.github/workflows/ci.yml`
- **Do:** On push and PR — install with cache, then `pnpm verify`. Fail the build on any non-zero exit.
- **Done when:** A PR with a deliberate type error is blocked by CI.
- **Size:** S

#### T-0.06 — Client dev server
- **Depends:** T-0.02
- **Files:** `packages/client/vite.config.ts`, `packages/client/index.html`, `packages/client/src/main.ts`
- **Do:** Vite dev server rendering a Three.js scene with a ground plane and an orbit camera. Configure COOP/COEP headers now — multithreaded WASM will need them later and retrofitting is painful.
- **Done when:** `pnpm --filter client dev` serves a visible lit plane at localhost; `crossOriginIsolated === true` in console.
- **Size:** S

#### T-0.07 — Server bootstrap
- **Depends:** T-0.02
- **Files:** `packages/server/src/main.ts`, `packages/server/src/config.ts`
- **Do:** Node entrypoint with tsx/esbuild watch, structured logging, env-based config, graceful SIGTERM shutdown.
- **Done when:** `pnpm --filter server dev` starts, logs a ready line, and exits cleanly on SIGTERM.
- **Size:** S

#### T-0.08 — Fixed timestep loop
- **Depends:** T-0.02
- **Files:** `packages/shared/src/sim/Clock.ts`, `Clock.test.ts`
- **Do:** Accumulator-based fixed-timestep driver at 30 Hz. Must expose current tick number, handle spiral-of-death clamping (max 5 catch-up steps), and be fully deterministic given a sequence of frame deltas.
- **Done when:** Unit test — feeding an identical delta sequence twice produces identical tick counts; a 10 s pause produces clamped catch-up, not 300 steps.
- **Size:** S

#### T-0.09 — ECS world and component registry
- **Depends:** T-0.02
- **Files:** `packages/shared/src/ecs/world.ts`, `components.ts`, `queries.ts`, tests
- **Do:** bitECS world factory. Components: `Transform`, `Velocity`, `Health`, `PlayerSlot`, `NetId`, `Replicated`. Registry maps component → stable numeric ID for serialization.
- **Done when:** Test creates 1000 entities, queries by archetype, destroys half, and confirms no ID reuse collisions.
- **Size:** M

#### T-0.10 — ⚠️ Rapier deterministic build in both runtimes
- **Depends:** T-0.09
- **Files:** `packages/shared/src/sim/physics.ts`, `physics.test.ts`
- **Do:** Load `@dimforge/rapier3d-compat-deterministic` WASM in Node *and* the browser behind one async init. Verify the exact published package name at pin time. The deterministic variant disables SIMD and the parallel solver; that is acceptable at this project's scale (6 players + ~40 AI, not thousands of bodies) and is what lets T-1.22 assert a tight bound. **Do not switch to the non-`compat` build to get determinism** — `compat` vs non-`compat` is about WASM loading strategy and is orthogonal to the determinism guarantee; dropping it breaks Node loading, which the entire shared-sim architecture depends on. Expose world creation, rigid body and collider helpers.
- **Done when:** The same test file passes under Node and under a browser test runner including **one non-V8 engine**, with positions agreeing within 1e-4 m after 100 steps of a falling body. Log the actual maximum divergence and the measured performance cost versus the default build.
- **Size:** M

#### T-0.11 — Parity test harness
- **Depends:** T-0.08, T-0.10, T-0.14
- **Files:** `packages/shared/test/harness/parity.ts`, `parity.test.ts`
- **Do:** Per §2.3, this **replaces** what would otherwise be a whole-world golden hash. Build the *harness*, not a specific test: run two independent simulation instances over a fixed input sequence and report per-tick divergence (max, mean, tick of first breach). Constants come from the caller's fixture, never from `data/*.json`, so gameplay tuning cannot break anything built on it. Prove it against a falling-body scenario; the character controller parity test lands with T-1.12.
- **Done when:** The harness reports divergence for a two-instance falling-body run in Node and in at least one non-V8 browser engine, and prints peak divergence on **every** run so the trend is visible before it becomes a failure.
- **Size:** M

#### T-0.12 — Headless sim harness
- **Depends:** T-0.11
- **Files:** `packages/shared/src/sim/Simulation.ts`, `packages/tools/src/sim-run.ts`
- **Do:** A `Simulation` class composing clock + world + physics with `step(inputs)` and `snapshot()`. CLI runs N ticks of a named scenario and reports final state, plus divergence against a second instance when run in parity mode.
- **Done when:** `pnpm sim-run --scenario fall --ticks 1000 --parity` completes and reports divergence within the T-0.11 bound.
- **Size:** M

#### T-0.13 — ADR scaffold
- **Depends:** —
- **Files:** `docs/adr/*.md`, `docs/CHANGELOG.md`
- **Do:** Write up ADR-001 through ADR-015 from §1, §2 and §4.1, one file each: context, decision, consequences, alternatives rejected. ADR-005 (Rapier build), ADR-014 (determinism policy) and ADR-015 (estimate reality) carry the review corrections — write those three first.
- **Done when:** Every 🔒 reference in this plan resolves to a real ADR file.
- **Size:** M

#### T-0.14 — Deterministic math primitives
- **Depends:** T-0.02
- **Do first:** despite its ID, this **blocks T-0.11 and T-1.12**. Schedule it immediately after T-0.03.
- **Files:** `packages/shared/src/math/trig.ts`, `prng.ts`, `trig.test.ts`
- **Do:** ECMAScript does not specify transcendental functions to bit precision (§2.3), so `Math.sin`/`cos`/`atan2` drift between a Node server and a Safari or Firefox client. Provide deterministic replacements. **Exploit the angle quantization from T-1.02:** angles are already integers at 1/1024 turn on the wire, so index a precomputed 4096-entry table by that integer — exact, no interpolation error, no engine variance, and cheaper than a polynomial approximation. Add a seeded PRNG (PCG32 or xorshift128+) for weapon spread. Extend the T-0.03 lint rule to ban `Math.(sin|cos|tan|atan|atan2|exp|log|pow|hypot|random)` inside `packages/shared`. `Math.sqrt` and the arithmetic operators are exactly specified by IEEE-754 — leave them alone.
- **Done when:** Table trig matches `Math.sin`/`cos` within 1e-6 across the full angle range; byte-identical outputs in Node and in a non-V8 browser engine; lint rejects a `Math.cos` call added to a shared file.
- **Size:** M

---

## 6. M1 — Netcode prototype ⚠️

**This milestone is the project's primary technical risk.** Two capsules, one
gun, five dumb enemies. No art, no animation, no polish. The only question
being answered is: *does an authoritative-server TPS feel good in a browser?*

### 6.1 Serialization

#### T-1.01 — BitStream
- **Depends:** T-0.02
- **Files:** `packages/shared/src/net/BitStream.ts`, `BitStream.test.ts`
- **Do:** Bit-level reader/writer over `ArrayBuffer`. Methods: `writeBits(value, n)`, `writeVarUint`, `writeFloat`, `writeBool`, `writeString`, matching readers. Must throw on over-read rather than returning garbage.
- **Done when:** Property test — 10,000 random round-trips per type return exact input; over-reading a buffer throws.
- **Size:** M

#### T-1.02 — Quantization
- **Depends:** T-1.01
- **Files:** `packages/shared/src/net/quantize.ts`, tests
- **Do:** Position at 1/64 m over a bounded world extent, angles at 1/1024 turn, velocities at 1/32 m/s. Each with documented range and error bound.
- **Done when:** Test asserts max round-trip error is within the documented bound across the full range, and that out-of-range values clamp rather than wrap.
- **Note:** the integer angle representation here is what T-0.14's trig table indexes. Keep the two in sync — changing angle resolution means regenerating the table.
- **Size:** S

#### T-1.03 — Snapshot schema
- **Depends:** T-1.02, T-0.09
- **Files:** `packages/shared/src/net/snapshot.ts`, tests
- **Do:** Per-component serializers driven by the T-0.09 registry. A snapshot is `{ tick, entities: [{ netId, componentMask, fields }] }`.
- **Done when:** A 50-entity world round-trips through serialize→deserialize with all replicated values within quantization tolerance.
- **Size:** M

#### T-1.04 — Delta compression
- **Depends:** T-1.03
- **Files:** `packages/shared/src/net/delta.ts`, tests
- **Do:** Encode a snapshot against a baseline: per-entity changed-field mask, plus spawn/despawn lists. Per-client baseline ring buffer keyed by acked tick.
- **Done when:** Test — a 50-entity world where 5 entities moved produces a delta under 20% the size of a full snapshot, and applying it to the baseline reproduces the new state exactly.
- **Size:** L

#### T-1.05 — Protocol messages
- **Depends:** T-1.04
- **Files:** `packages/shared/src/net/protocol.ts`, tests
- **Do:** Tagged message union — `Join`, `JoinAck`, `Input`, `Snapshot`, `Ack`, `Ping`, `Pong`, `Disconnect`. Version byte in the handshake; mismatched versions are rejected with a clear reason.
- **Done when:** Every message type round-trips; a wrong version byte produces a rejection, not a crash.
- **Size:** M

### 6.2 Transport

#### T-1.06 — Transport interface
- **Depends:** T-1.05
- **Files:** `packages/shared/src/net/Transport.ts`
- **Do:** Interface only — `send(data, channel)`, `onMessage`, `onClose`, where channel is `reliable | unreliable`. Everything downstream codes against this so WebTransport can replace WebSocket without touching game code.
- **Done when:** Interface compiles; no implementation in `shared`.
- **Size:** S

#### T-1.07 — WebSocket server transport
- **Depends:** T-1.06, T-0.07
- **Files:** `packages/server/src/net/WsTransport.ts`, tests
- **Do:** uWebSockets.js implementation. Both channels map to TCP for now (documented limitation). Per-connection send buffering with backpressure handling.
- **Done when:** Integration test — 8 concurrent connections exchange 1000 binary messages each with zero loss or corruption.
- **Size:** M

#### T-1.08 — WebSocket client transport
- **Depends:** T-1.06
- **Files:** `packages/client/src/net/WsTransport.ts`, tests
- **Do:** Browser implementation with auto-reconnect and exponential backoff.
- **Done when:** Test against a local server — connect, exchange, kill server, confirm backoff retries, restart server, confirm reconnect.
- **Size:** M

#### T-1.09 — Connection lifecycle
- **Depends:** T-1.07, T-1.08
- **Files:** `packages/server/src/session/Connection.ts`, `packages/client/src/net/Connection.ts`, tests
- **Do:** Handshake → join → active → disconnect state machine. Server assigns `NetId` and slot index. Timeout on missing heartbeat (5 s).
- **Done when:** Test covers every state transition including timeout-triggered disconnect.
- **Size:** M

#### T-1.10 — Clock sync
- **Depends:** T-1.09
- **Files:** `packages/shared/src/net/clockSync.ts`, tests
- **Do:** Ping/pong RTT estimation with a rolling median, server-time offset estimate, and jitter measurement. Client derives its render-time offset from this.
- **Done when:** Test with synthetic latency (100 ms ± 30 ms jitter) converges to within 10 ms of true offset inside 5 s.
- **Size:** M

### 6.3 Simulation and prediction

#### T-1.11 — Input commands
- **Depends:** T-1.05
- **Files:** `packages/shared/src/sim/input.ts`, tests
- **Do:** `InputCommand { tick, moveX, moveY, yaw, pitch, buttons }`, bit-packed. Client keeps a ring buffer of unacked commands; each packet redundantly includes the last 3 commands to survive single-packet loss.
- **Done when:** Round-trip test; buffer correctly drops commands at and below the acked tick.
- **Size:** M

#### T-1.12 — Character controller
- **Depends:** T-0.10, T-0.14, T-1.11
- **Files:** `packages/shared/src/sim/CharacterController.ts`, tests
- **Do:** Rapier kinematic character controller. Walk, run, crouch, jump, slope limits, step offset, gravity. **Pure function of (state, input, dt)** — no hidden state, no wall-clock reads, no `Math.random`. Yaw→direction conversion **must** use T-0.14 table trig, never `Math.sin`/`Math.cos`. This is the single most likely source of a client/server drift that costs a week to diagnose, because it is invisible on a V8-to-V8 pairing (§2.3).
- **Done when:** Using the T-0.11 harness, two instances over a fixed 500-tick sequence (slopes, steps, wall slides, jumps) diverge by under 1e-4 m, in Node and in at least one non-V8 browser engine. Movement constants live in the test fixture, not `data/*.json`. Peak divergence printed on every run.
- **Size:** L

#### T-1.13 — Server tick loop
- **Depends:** T-1.12, T-1.09
- **Files:** `packages/server/src/session/Session.ts`, tests
- **Do:** 30 Hz authoritative loop — drain input queues, step simulation, build per-client deltas, broadcast. Handle clients whose input is missing (repeat last input, up to 5 ticks, then idle).
- **Done when:** Integration test — a session with 2 connected bot clients runs 300 ticks with stable timing and no dropped snapshots.
- **Size:** L

#### T-1.14 — Client prediction
- **Depends:** T-1.13
- **Files:** `packages/client/src/net/prediction.ts`, tests
- **Do:** Apply local input immediately through the same `CharacterController`. Store `(tick, state)` history for reconciliation.
- **Done when:** With zero latency, predicted state matches server state exactly every tick.
- **Size:** M

#### T-1.15 — Reconciliation
- **Depends:** T-1.14
- **Files:** `packages/client/src/net/reconcile.ts`, tests
- **Do:** On snapshot receipt, snap local entity to the authoritative state, then replay all unacked inputs. Smooth residual error over ~100 ms rather than snapping visibly.
- **Done when:** Test — inject a 50-tick divergence and confirm convergence within 5 ticks; log peak prediction error.
- **Size:** L

#### T-1.16 — Entity interpolation
- **Depends:** T-1.13
- **Files:** `packages/client/src/net/interpolate.ts`, tests
- **Do:** Buffer remote entity states, render at `serverTime - 100 ms`. Hermite interpolation for position, shortest-arc slerp for rotation. Extrapolate up to 250 ms on starvation, then freeze.
- **Done when:** Test with 20% simulated packet loss produces visually continuous positions (no NaN, no discontinuity above a threshold).
- **Size:** M

### 6.4 Combat

#### T-1.17 — Hitscan weapons
- **Depends:** T-1.12
- **Files:** `packages/shared/src/sim/weapons.ts`, `packages/shared/src/data/weapons.json`, schema, tests
- **Do:** Data-driven weapon definitions — RPM, damage, spread, falloff, mag size, reload time. Spread uses the T-0.14 seeded PRNG and table trig, seeded from tick + entity id — never `Math.random`.
- **Done when:** Same tick and seed produce identical spread vectors in Node and in a non-V8 browser engine. **Decide before implementing:** per §2.3, if the client draws tracers from the server hit event rather than predicting them, this parity requirement disappears entirely and the seeded path can be server-only.
- **Size:** M

#### T-1.18 — Lag compensation
- **Depends:** T-1.17, T-1.16
- **Files:** `packages/server/src/net/lagComp.ts`, tests
- **Do:** Per-entity hitbox position history (ring buffer, 500 ms). On a fire command, rewind hitboxes to the firing client's render time, raycast, restore. Clamp rewind at 200 ms.
- **Done when:** Test — a client at 150 ms latency firing at a moving target registers a hit that would have missed without compensation; a client claiming 5 s of latency is clamped.
- **Size:** L

#### T-1.19 — Damage, death, respawn
- **Depends:** T-1.18
- **Files:** `packages/shared/src/sim/damage.ts`, tests
- **Do:** Health component, hit zone multipliers (head/torso/limb), death state, 5 s respawn at a spawn point. Downed/revive is deferred to M2.
- **Done when:** Test — cumulative damage kills at the correct threshold; respawn restores full health at a valid spawn.
- **Size:** M

### 6.5 Verification tooling

> These four tasks are what make the rest of this project agent-executable.
> Prioritize them — T-1.20 in particular unblocks automated verification for
> every networked task above.

#### T-1.20 — Headless bot client
- **Depends:** T-1.09, T-1.14
- **Files:** `packages/bot/src/BotClient.ts`, `packages/bot/src/main.ts`
- **Do:** A full client — transport, prediction, reconciliation — with no renderer. Inputs come from a scripted sequence or a seeded random walk. Exposes its predicted local-player state and observed remote-entity states for divergence measurement. Per §2.3 this is **not** a world-hash comparison — the server is authoritative, so only prediction parity is meaningful.
- **Done when:** `pnpm bot --count 2 --ticks 600` connects two bots to a local server and both report peak prediction divergence under 1e-3 m at zero simulated latency.
- **Size:** L

#### T-1.21 — Network condition simulator
- **Depends:** T-1.07
- **Files:** `packages/shared/src/net/NetSim.ts`, tests
- **Do:** A transport decorator injecting configurable latency, jitter, packet loss, and duplication. Dev/test builds only.
- **Done when:** Measured delivery statistics match configured parameters within 5% over 10,000 messages.
- **Size:** M

#### T-1.22 — Netcode CI test suite
- **Depends:** T-1.20, T-1.21
- **Files:** `packages/bot/test/convergence.test.ts`
- **Do:** Matrix test — 2 and 6 bots × {0 ms, 80 ms, 200 ms} latency × {0%, 5%, 20%} loss. Per §2.3 assert **bounded prediction divergence and correction frequency**, not hash equality: peak local-player divergence under threshold, correction rate under threshold, and no unbounded drift across the run. Record numbers per cell so regressions surface as a trend rather than a binary.
- **Done when:** The full matrix passes in CI in under 5 minutes and emits a per-cell divergence table. **This is M1's real exit gate.**
- **Size:** L

#### T-1.23 — Netgraph overlay
- **Depends:** T-1.15, T-1.16
- **Files:** `packages/client/src/ui/Netgraph.ts`
- **Do:** Debug overlay — RTT, jitter, loss, snapshot size, prediction error, interpolation buffer depth, server tick drift. Toggle with a key.
- **Done when:** Overlay renders live during a two-client session and its numbers track values injected by T-1.21.
- **Size:** M

#### T-1.24 — 🧍 M1 playtest gate
- **Depends:** T-1.22, T-1.23
- **Files:** `docs/playtests/m1.md`
- **Do:** Two humans play the prototype at 0 ms, 80 ms, and 200 ms simulated latency. Record whether shooting feels responsive and fair, and whether movement feels rubber-bandy.
- **Done when:** A written verdict exists. **If this fails, stop and revisit ADR-012 before starting M2.** No amount of green CI substitutes for this judgement.
- **Size:** S

---

## 7. M2–M5 — Epics

Deliberately coarse. Each gets broken into leaf tasks at its planning gate,
using the T-1.xx tasks above as the template for granularity.

### M2 — Shooter feel (~8–10 wks)

| Epic | Scope | Notes |
|---|---|---|
| E-2.1 | Third-person camera | Spring arm, collision, shoulder swap, ADS transition · 🧍 |
| E-2.2 | Locomotion state machine | Blend tree, 8-way movement, crouch, vault |
| E-2.3 | Animation system | Aim offsets (additive), reload/fire layers, hit reactions, IK foot placement |
| E-2.4 | Weapon feel | Recoil patterns, camera shake, muzzle flash, tracers, shell ejection · 🧍 |
| E-2.5 | Projectile weapons | Grenades, RPG — ballistic arcs, network-replicated |
| E-2.6 | Downed & revive | Bleed-out timer, crawl state, revive interaction |
| E-2.7 | Combat audio | Positional Web Audio, weapon layers, distance falloff, occlusion approximation |

**Exit gate:** 🧍 A human plays a grey-box firefight and signs off that it feels good.

### M3 — AI & squad command (~10–12 wks)

| Epic | Scope | Notes |
|---|---|---|
| E-3.1 | Navmesh pipeline | Recast bake in `tools`, runtime Detour queries, off-mesh links |
| E-3.2 | AI locomotion | Path following, steering, local avoidance |
| E-3.3 | Behavior tree runtime | Data-driven trees, blackboard, 10 Hz scheduler |
| E-3.4 | Perception | Vision cone + LOS raycast, hearing events, stimulus memory |
| E-3.5 | Combat AI | Cover point selection, suppression, flanking, grenade usage |
| E-3.6 | Enemy archetypes | Rifleman, MG, RPG, sniper, officer |
| E-3.7 | Friendly bot | Slot backfill, formation following, order execution (ADR-001) |
| E-3.8 | Order system | Order wheel UI → network command → bot behavior; target marking |
| E-3.9 | AI director | Encounter pacing, reinforcement waves, scaling on human count |

**Exit gate:** A solo player with 5 bots and 6 human players both complete the same grey-box mission. Enemies demonstrably take cover and suppress.

**Risk:** highest uncertainty in the project after M1. Combat AI that reads as competent is genuinely hard. Budget generously and expect the estimate to move.

### M4 — Content systems (~10–12 wks)

| Epic | Scope |
|---|---|
| E-4.1 | Asset pipeline — Blender → glTF → gltf-transform (Draco + KTX2) → manifest |
| E-4.2 | Runtime asset loading, streaming, LOD, budget enforcement in CI |
| E-4.3 | Level format + modular kit (~60 pieces) + lightmap bake |
| E-4.4 | Mission scripting — objectives, triggers, spawners, scripted events |
| E-4.5 | Lobby, matchmaking, session lifecycle, drop-in/drop-out |
| E-4.6 | Persistence — accounts, campaign saves, per-soldier XP (Postgres + Redis) |
| E-4.7 | HUD, menus, class selection, scoreboard |
| E-4.8 | Vehicles — mounted MG first, driveable second |
| E-4.9 | Deployment — regional game servers, session orchestration, observability |

### M5 — Vertical slice (~6–8 wks at §4.1 scope)

One finished 10-minute mission at the reduced scope in §4.1: **two classes, two
enemy types, ~25-piece kit, mounted MG**. Six playable slots with bot backfill —
the architecture ships whole even though the content does not. Full audio pass.
Baked lighting. Onboarding. Performance to the §2.2 budget on target hardware.

This is the artifact you show people, and the thing it is meant to prove is the
netcode and the squad architecture — not breadth.

---

## 8. Risk register

| # | Risk | Severity | Mitigation | Owner milestone |
|---|---|---|---|---|
| R1 | **Art volume** — a TPS needs 80–120 animation clips; art sinks more of these projects than code | Critical | **§4.1 cut: slice ships 2 classes, 2 enemy types, ~35 clips, ~25-piece kit** · one shared humanoid rig for all soldiers and enemies · purchased mocap · prone and vault cut from v1 | M4 |
| R2 | **Cover-shooter netcode** doesn't feel good in a browser | Critical | M1 exists solely to answer this, before any content investment | M1 |
| R3 | **Combat AI** fails to read as competent | High | Dedicated milestone, early grey-box prototyping, generous buffer | M3 |
| R4 | **Six players amplifies level cost** — wider levels, ~1.5× encounter density | High | Two-fireteam mission template (§1.2); reuse kit aggressively | M4 |
| R5 | **Browser performance** on lower-end hardware | Medium | Budget enforced in CI (E-4.2) · desktop-only v1 (ADR-002) | M4 |
| R6 | **Cross-platform simulation drift** — Rapier's default build guarantees only *local* determinism, and JS transcendentals differ by engine | High | Deterministic Rapier build (ADR-005) · table trig in `shared/math` (T-0.14) · parity harness logging divergence trend (T-0.11) · **CI runs a non-V8 engine**, without which the bug is invisible | M0 |
| R7 | **Hosting cost** at scale | Medium | Session-based regional allocation; measure early, model before launch | M4 |
| R8 | **IP exposure** | Low but absolute | Original names, characters, and assets throughout. Historical setting is fine; real unit insignia and branding are not. | Ongoing |
| R9 | **Scope creep** | High | Anything not in §1.4 goes to a backlog file, not into a milestone | Ongoing |
| R10 | **Determinism theater** — a whole-world golden hash that breaks on every tuning change, gets re-baselined reflexively, then catches nothing | Medium | §2.3 scopes parity to the two paths that actually need it; parity tests own their constants in the fixture | M0 |
| R11 | **Estimates are a floor, not a plan** — §4 sums to ~50 wks; comparable solo projects run 3–5× | High | §4.1 scope cut · re-estimate at every milestone gate from *measured velocity*, never from this table | Ongoing |

---

## 9. Open questions

These block estimation, not implementation — M0 can start today regardless.

1. **Team size.** Every estimate in §4 assumes solo part-time. Four people
   (gameplay/net, graphics, artist, designer) compresses the vertical slice to
   roughly four months.
2. **Art sourcing.** Purchased assets vs. commissioned vs. in-house? This is R1,
   the project's largest cost, and it should be decided before M4.
3. **Desktop-only confirmation.** Recommended and assumed (ADR-002). Mobile
   Safari support would add months.
4. **Where does this repo live?** This plan currently sits in an unrelated
   repository. It should move to a dedicated one before M0 starts.
5. **Session persistence model.** Does a campaign save belong to the host, or
   does every player carry their own soldier's progression across sessions?
   Affects E-4.6 substantially.

---

## 10. Immediate next actions

1. Answer Q1–Q4 in §9.
2. Create the dedicated repository; move `PLAN.md` into it.
3. Run **T-0.13** (write the ADRs). It costs little and stops agents from
   re-litigating locked decisions in every subsequent task. Write **ADR-005**
   (Rapier build), **ADR-014** (determinism policy) and **ADR-015** (estimate
   reality) first — they carry the review corrections.
4. Run **T-0.01 → T-0.05** sequentially; they are small and unblock everything.
5. Run **T-0.14** (deterministic math) next. Despite its ID it blocks T-0.11 and
   T-1.12, and it is the cheapest available insurance against a drift bug that
   stays invisible until the first Safari player joins.
6. Run **T-0.06** and **T-0.07** in parallel.
7. Spike **T-0.10** early — confirm the deterministic Rapier build loads in both
   runtimes and **measure its actual performance cost**. If that cost is real at
   this scale, ADR-005 and §2.3 both need revisiting before M1 starts.
8. Add a non-V8 browser engine to CI before T-1.12 lands. Without it, §2.3's
   central hazard cannot be detected by any test in this plan.
