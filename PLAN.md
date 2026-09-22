# SANDLINE — Browser Co-op Squad Shooter

**Project plan & agent-executable task backlog**

A browser-based, 6-player co-op third-person squad shooter in the spirit of
early-2000s console squad tactics games. Original IP — no licensed names,
characters, or assets.

> `SANDLINE` is a placeholder codename. Rename before any public artifact.

> **Revision 2.1.** Incorporates external technical review: determinism scoping
> (§2.3), the Rapier build correction (ADR-005), deterministic trig (T-0.14),
> and the vertical-slice scope cut (§4.1). 2.1 removes four surviving
> bit-equality claims that contradicted §2.3.

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
   It must run headless in Node and in the browser. This is what makes the
   authoritative server possible. Where the two must agree numerically, §2.3
   sets how closely and T-0.11 measures it — the bar is **bounded divergence,
   never bit-equality**.
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
| Physics | Rapier, **deterministic build** (`@dimforge/rapier3d-deterministic-compat`) | ADR-005 | Same WASM in Node and browser. The default build guarantees only *local* determinism — see §2.3 |
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
CI assertion. Agents cannot verify feel, but they *can* verify that every bot's
predicted state tracks the authoritative server within a bounded error (§2.3).
Build it early (T-1.20).

---

## 4. Milestones

| ID | Milestone | Exit gate | Est. (solo, part-time) |
|---|---|---|---|
| **M0** | Foundations | `pnpm verify` green in CI; parity harness reports bounded divergence over 1000 ticks in Node *and* a non-V8 engine | 2–3 wks |
| **M1** | ⚠️ Netcode prototype | 2 clients (one human, one bot), capsules, four hitscan weapons, static range targets, playable at 200 ms simulated latency | 6–8 wks |
| **M1.5** | Two humans, one session — **closed** | Two human gates passed; R2 closed; deployed host verified | 3–4 wks |
| **M2** | Shooter feel | 🧍 Third-person combat that a human signs off as good | 8–10 wks |
| **M3** | AI & squad command | 6 slots with bot backfill; enemies use cover and suppress | 10–12 wks |
| **M4** | Content systems | Asset pipeline, level format, mission scripting, saves | 9–11 wks |
| **M5** | Vertical slice | One finished 10-minute mission at §4.1 scope, 6 slots, demo-able | 6–8 wks |

**M0 + M1 are the real gate.** Build zero content until the netcode prototype
feels good under simulated adverse network conditions. If M1 fails, the project
changes shape — that is exactly what the gate is for.

**M1's gate amended 2026-09-18.** It previously read "2 players, capsules, one
hitscan rifle, 5 dumb enemies, playable at 120 ms". Three corrections, none of
them a scope cut made to reach the gate sooner:

- **The five dumb enemies are gone from it.** No leaf task in §6 ever owned
  them, so this was a gate requirement with no task behind it rather than work
  that got skipped. The netcode question does not need them either: a static
  dummy exercises the identical hitscan, lag compensation and damage falloff
  path (`packages/shared/src/sim/range.ts`). Enemy behaviour is M3 — E-3.2 AI
  locomotion, E-3.5 combat AI, E-3.6 archetypes — and **target health lands
  with the behaviour that justifies it**, because health on something that
  cannot move or shoot back is a number with nothing behind it.
- **"2 players" is now "2 clients".** Two real `NetClient`s do connect to the
  session, but only one is a person; see T-1.24.
- **120 ms became 200 ms**, matching what T-1.22 already asserts in CI and what
  T-1.24 actually plays.

**M1.5 closed 2026-09-19.** The two-human milestone was completed to answer the
real-socket question before M2. T-1.5.03 (LAN) and T-1.5.08 (internet) both
passed, R2 closed, and the single-host deployment is live at
`wss://sandline-host.fly.dev`. The original rationale remains in §4.2.

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

### 4.2 M1.5, and why hosting moved forward

**Added 2026-09-18.** This plan never stated that two people connecting to each
other is a milestone. It was implied by E-4.5 — lobby, matchmaking, session
lifecycle, drop-in/drop-out — sitting in M4 roughly thirty weeks out, with
E-4.9 deploying a host beside it. That was an ordering mistake rather than a
missing intent, and it is corrected here.

**The pillar is human-to-human play.** M1 asked *does an authoritative-server
TPS feel good in a browser* and answered it against a simulated link and a bot.
Every unknown ADR-012's addendum then listed — real jitter distributions,
reordering under congestion, NAT, and two players' inputs interacting — needs a
second person on the far end of a real socket. Leaving that until M4 means
building shooter feel (M2), AI (M3) and content systems on top of a question
the project has never once asked.

**The parts already exist and are simply not joined up.** `Session` runs six
slots with bot backfill and per-client deltas (T-1.13). `startWsServer` accepts
sockets and is tested at eight concurrent connections (T-1.07).
`WsClientTransport` reconnects with backoff (T-1.08). The handshake assigns
NetId and slot and times out a silent peer (T-1.09). What does not exist is a
process that connects them: `packages/server/src/main.ts` is still T-0.07's
bootstrap, stepping a bare `Simulation` with no transport at all. The first task
of this milestone is plumbing, not architecture, and the first two tasks are
what put two humans in one session.

**It is mostly moved work, not added work.** M1.5 takes the single-host slice
out of E-4.9 and the room/join half out of E-4.5, so M4 drops to 9–11 weeks and
§4.1's ~50-week floor is unchanged. (That is the only reason M4's estimate moved;
§4.1's scope cut did not touch it.) What is genuinely new is the client's remote
branch and the two 🧍 gates — which is the point of doing it.

**It restores T-1.24 to what it originally said.** That task specified two
humans and was amended down to one for precisely the reason this milestone
removes. Once T-1.5.02 lands the amendment is moot: run T-1.24's three link
settings with two people, and the addendum's largest gap — two players shooting
each other under lag compensation — closes with it.

**What this is not: peer-to-peer.** ADR-011 rejects P2P with host migration on
three counts — the host gets a latency advantage, NAT traversal needs the TURN
infrastructure ADR-008 declined, and a hostile host can corrupt the session.
That decision is unchanged and is not re-litigated here. Two players connect
*to each other through an authoritative host*, which is the only arrangement in
which the shot arbitration T-1.5.03 and T-1.5.08 go looking for means anything.
During development that host may be a process on one of the two machines; in
production it is a dedicated one (ADR-011). Everything in this milestone is the
client/server shape M1 already built — what changes is that the far end of the
socket becomes a person.

---

## 5. M0 — Foundations

Goal: a monorepo where shared simulation code runs headless in Node and in the
browser, agreeing to within the §2.3 bounds, verified in CI on a non-V8 engine
as well as V8.

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
- **Do:** Load `@dimforge/rapier3d-deterministic-compat` WASM in Node *and* the browser behind one async init. Verify the exact published package name at pin time. The deterministic variant disables SIMD and the parallel solver; that is acceptable at this project's scale (6 players + ~40 AI, not thousands of bodies) and is what lets T-1.22 assert a tight bound. **Do not switch to the non-`compat` build to get determinism** — `compat` vs non-`compat` is about WASM loading strategy and is orthogonal to the determinism guarantee; dropping it breaks Node loading, which the entire shared-sim architecture depends on. Expose world creation, rigid body and collider helpers.
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

**This milestone is the project's primary technical risk.** Two capsules, four
guns, static targets to shoot at. No art, no animation, no polish, no enemy
behaviour (§4). The only question being answered is: *does an
authoritative-server TPS feel good in a browser?*

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
- **Completed 2026-09-19, with one deliberate departure.** World collision is
  against a shared static world of axis-aligned boxes
  (`packages/shared/src/sim/world.ts`, cover in `data/world.json`) in pure
  arithmetic, not Rapier's kinematic controller — see the ADR-005 addendum.
  Walls, crates, posts and rails stop the player (slide, step-up to 0.45 m,
  land on cover, head room) and stop shots on the server (`resolveShot`), and
  the client renders, aim-converges and camera-collides against the same
  list, which closes note 16's hand-maintained shootable set. The 500-tick
  parity sequence (`test/harness/characterParity.test.ts`) walks steps, walls,
  a jump onto cover and off it, and runs in the non-V8 browser job; measured
  divergence is exactly 0. **Not done:** slopes and stairs beyond a step —
  boxes cannot express them, and the grey-box firefight does not need them
  first. If M3's levels do, the box world is the thing to replace, not the
  controller's contract.

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
- **Done when:** With zero latency, predicted state tracks server state within 1e-4 m every tick, and the test records peak divergence. Per §2.3 and R10, do **not** assert exact equality here — that is precisely the tripwire that gets disabled the first time it fires.
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
- **Done when:** `pnpm bot --count 2 --ticks 600` connects two bots to a local server and both report peak prediction divergence below the **correction threshold** (2 cm) at zero simulated latency, with zero corrections.
- **Note (revised 2026-09-17):** this originally said 1e-3 m. That figure predates the wire format and is *unachievable by construction*: position quantizes to 1/64 m, so a 3D distance carries up to sqrt(3) x half a step — about 13.5 mm — of pure encoding error. Measured divergence is ~12 mm, i.e. the quantization floor. The meaningful property is that divergence stays under the threshold at which a player would see a correction.
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
- **Do:** A human plays the deployed harness at the three T-1.22 link settings — LAN, 80/15/5%, and 200/40/20% — and records whether shooting feels responsive and fair and whether movement feels rubber-bandy. Your link and the sparring partner's link are set **independently**, so run each setting on your own link against a LAN partner, then hold your own at LAN and put the partner on the worst one. "I am lagging" and "they are lagging" are different faults in different code and the verdict should judge them apart.
- **Done when:** A written verdict exists. **If this fails, stop and revisit ADR-012 before starting M2.** No amount of green CI substitutes for this judgement.
- **Size:** S

**Amended 2026-09-18: one human, not two.** There is nowhere for a second human
to join. GitHub Pages is static hosting, the authoritative session runs inside
the tab over a loopback pair through NetSim, and ADR-011's regional hosting is
The original one-human amendment is retained as historical context. The
subsequent M1.5 LAN and internet gates supplied the missing two-human and
real-internet evidence; see the playtest records and ADR-012 closing addendum.

---

## 6A. M1.5 — Two humans, one session — CLOSED

**Closed 2026-09-19.** See §4.2 for why this milestone sits here rather than inside M4. The tasks below are the completed historical specification and acceptance record.

The question: *does it still feel fair when the thing shooting at you is a
person, on a real socket, at whatever latency the internet gives?* M1 answered
the single-player half of that against NetSim and a bot. This milestone answers
the other half, and R2 does not close until it does.

Ordered so the first human-to-human shot lands at **T-1.5.02**, two tasks in,
rather than at the end. Everything from T-1.5.04 onward — codes, rooms, lobby,
deployment — is what turns "two tabs against a laptop" into "two people on
different networks", and none of it blocks the first playtest.

Task IDs follow §0.1: `T-1.5.<n>`, milestone 1.5.

> **Historical handoff:** [`docs/HANDOFF-M1.5.md`](docs/HANDOFF-M1.5.md) retains the
> operational setup and debugging notes from this milestone. M2 is the current
> milestone; this section is the completed M1.5 specification and record.

### 6A.1 A host that serves

#### T-1.5.01 — ✅ COMPLETED Session host process
- **Depends:** T-1.07, T-1.09, T-1.13
- **Files:** `packages/server/src/main.ts`, `packages/server/src/session/SessionHost.ts`, `SessionHost.test.ts`, `packages/bot/src/main.ts`, root `package.json`
- **Do:** `packages/server/src/main.ts` is still T-0.07's bootstrap — it steps a bare `Simulation` and never calls `startWsServer`, so the dedicated server has never served a session to anything. Join them: accept sockets with `startWsServer` (T-1.07), hand each to `Session.addConnection` (T-1.13), and drive `Session.step` from a wall-clock loop using the `Clock` spiral clamp (T-0.08). Wrap each connection in `NetSim` behind `LINK_LATENCY_MS` / `LINK_JITTER_MS` / `LINK_LOSS` env vars, so a real socket can still carry the conditions T-1.24's sliders inject today — without this, the first remote playtest loses the instrument that made the local one useful. Drop silent peers on the existing 5 s heartbeat. `SIGTERM` sends `Disconnect` to every connection before exit rather than dropping sockets. Add `--url` to the bot CLI so it drives a real socket instead of a loopback pair.
- **Done when:** `pnpm host` boots and logs its port; `pnpm bot --url ws://localhost:8080 --count 2 --ticks 600` joins two bots over real sockets and reports peak prediction divergence under the 2 cm correction threshold with zero unmatched reconciles — the identical assertion T-1.20 makes in-process, now across a wire; killing the host mid-run makes both bots report a clean close rather than hang.
- **Note:** the point of reusing the bot's own thresholds is that a *difference* between the loopback and socket numbers is the finding. They should match; if they do not, something in the netcode was depending on the loopback pair.
- **Size:** M

#### T-1.5.02 — ✅ COMPLETED The client joins a remote host
- **Depends:** T-1.5.01, T-1.08
- **Files:** `packages/client/src/net/RemoteServer.ts`, `packages/client/src/main.ts`, `packages/client/src/ui/NetworkPanel.ts`
- **Do:** The harness unconditionally builds a `LocalServer` — an in-page `Session` over a loopback pair. Add the other branch: `?host=ws://…` builds a `WsClientTransport` (T-1.08) instead, skips the in-page session and the `SparringPartner` entirely, and drives the existing `NetClient` from it unchanged. Everything downstream already codes against `Transport` (ADR-008), so this should touch startup and nothing else — if it does not, that is assumption leakage the ADR predicted and the finding is worth more than the task. In-page stays the default, so the published build is unaffected. Surface connection state in the HUD — connecting, joined as slot *n*, retrying (attempt and delay), gave up — because on a real socket "nothing is happening" must be distinguishable from "nothing is moving". When remote, grey the link sliders out and say why: conditioning now lives on the host (T-1.5.01), and a slider that silently does nothing is worse than no slider.
- **Done when:** Two browser tabs pointed at one local host process take two of the six slots, see each other move, and damage each other; the netgraph's RTT is a measured socket round-trip rather than NetSim's configured number; closing one tab hands its slot back to a bot within the heartbeat timeout and the other tab plays on.
- **Size:** M

#### T-1.5.03 — ✅ COMPLETED 🧍 LAN two-human gate
- **Depends:** T-1.5.02
- **Files:** `docs/playtests/m1.5-lan.md`
- **Verdict written 2026-09-20** (`docs/playtests/m1.5-lan.md`), after the fact, from the one-line record: PASS, with the individual cases and the conditioning levels the task asked for stated as not recorded.
- **Do:** Two people, two machines, one host on the LAN. The first time this project has had two humans in one session. Judge only what the second human adds — anything a lone tester can assess belongs to T-1.24. Specifically: two players contesting one doorway; each shooting the other inside the same 200 ms rewind window; whether "I shot first" disputes resolve in a way *both* people accept; whether a corpse taking no further damage reads as correct or as a swallowed hit. Run at LAN, then with the host's conditioning at 80 and 200 ms, setting the two players' conditions independently as T-1.24 requires.
- **Done when:** A written verdict naming which of those cases feel fair and which do not, and stating what a LAN still leaves unproven — NAT, internet jitter distributions, routing, and any latency a slider did not put there.
- **Size:** S

### 6A.2 Rooms, and getting two people into the same one

#### T-1.5.04 — ✅ COMPLETED Join codes and typed reject reasons
- **Depends:** T-1.5.01
- **Files:** `packages/shared/src/net/protocol.ts`, `packages/shared/src/net/Connection.ts`, tests
- **Do:** `Join` carries a room code alongside version and name; `JoinAck` carries the room it landed in. Replace the handshake's single free-text reason with a typed rejection — `bad version`, `no such room`, `room full`, `host draining` — so the client can say which happened instead of "disconnected". Bump `PROTOCOL_VERSION` 5 → 6; it is already the guard that catches a stale client, and a published client will now be older than the host routinely. Generate codes from an alphabet without visually confusable characters, because they get read aloud over voice.
- **Done when:** Every message round-trips (extend T-1.05's property test); each rejection reaches the client distinguishable from the others; a v5 client against a v6 host is rejected on version, not on room.
- **Size:** S

#### T-1.5.05 — ✅ COMPLETED Room registry and session lifecycle
- **Depends:** T-1.5.04
- **Files:** `packages/server/src/session/Registry.ts`, `packages/server/src/main.ts`, tests
- **Do:** One process, many sessions. Create a room and return its code, look one up, refuse a join into a full one, and reclaim a room once its last human leaves and a grace period passes — a bot-only session still costs a full 30 Hz tick loop and should not outlive the people in it, but reclaiming it the instant someone's wifi drops loses their game. Cap rooms per process, and connections per room at six (ADR-001). §3 already names `server/src/session/` as "room, tick loop, player slots"; this is the room half, which has never existed.
- **Done when:** Two clients with the same code share a session and see each other; two clients with different codes cannot see each other at all; a seventh client into a full room is rejected with `room full`; an emptied room's tick loop stops and its entities are released; the process cap rejects rather than degrades.
- **Size:** M

#### T-1.5.06 — ✅ COMPLETED Lobby
- **Depends:** T-1.5.05, T-1.5.02
- **Files:** `packages/client/src/ui/Lobby.ts`, `packages/client/src/main.ts`, `packages/client/src/net/RemoteServer.ts`
- **Do:** The screen before the session. Choose a host, create a room or join a code, see all six slots with human/bot per slot, leave back to it. The roster is six rows always, never a growing list — ADR-001 is the reason, and a lobby that shows "2 players" teaches everyone the wrong model of the game. Put the code in a shareable link so the second player pastes a URL rather than types. Name the T-1.5.04 reason on a failed join. **Deliberately out of scope:** matchmaking, parties, region selection, ready-checks, class selection — those stay in E-4.5 and E-4.7.
- **Done when:** One person hosts, sends the link, the other opens it, and both are in the same session within two clicks of the page loading; the roster shows four bots and two humans, and a slot visibly flips back to bot when someone leaves.
- **Size:** M

> **Amended 2026-09-18, after T-1.5.02 shipped.** The acceptance above was
> written around a shareable link. That is still the fast path, but it is no
> longer sufficient: **a person must be able to join entirely from the page** —
> open the QA site, type a room code, play. No query parameter, no terminal, no
> URL construction by hand.
>
> `?host=` (T-1.5.02) and `pnpm host` (T-1.5.01) are developer tools and stay
> that way. They are how the netcode gets tested; they are not how a playtester
> joins, and a gate that depends on a tester editing a URL is a gate that will
> be run once by the person who wrote it.
>
> So the lobby owns the host address too, not just the room code: a default
> host baked into the build (T-1.5.07), overridable in the UI for a LAN or a
> local process. The query parameter, where present, pre-fills the lobby rather
> than bypassing it — otherwise there are two entry points and only one of them
> gets tested.
>
> **This makes T-1.5.07 a hard dependency of the goal, not a follow-on.** The
> QA site is served over https and a browser will not open `ws://` from it, so
> "join from the QA site" is impossible until a `wss://` host exists. Until
> then the lobby is testable only against a local host over plain http.

### 6A.3 A host on the internet

#### T-1.5.07 — ✅ COMPLETED One deployed host
- **Depends:** T-1.5.05
- **Files:** `packages/server/Dockerfile`, `docs/DEPLOYING.md`, `.github/workflows/`
- **Do:** E-4.9's first slice and nothing more: one region, one process. A container running the host; **TLS**, because the client is served over HTTPS and no browser will open a `ws://` socket from an `https://` page — this is the single most likely way this task fails and it fails silently in the console; a health endpoint; T-0.07's structured logger shipping somewhere readable; and the client's default host pointing at it. **Explicitly not:** multi-region, allocation, orchestration, autoscaling, matchmaking, or observability beyond logs. All of that stays in E-4.9.
- **Done when:** Two people on different networks, neither on a VPN, join the same room from the published client and play; the host survives both of them leaving and a third person joining afterwards; `DEPLOYING.md` documents redeploy *and teardown*, including how to take the host down between playtests (R12).
- **Size:** M

#### T-1.5.08 — ✅ COMPLETED 🧍 M1.5 gate: two humans, one real host
- **Depends:** T-1.5.07, T-1.5.06, T-1.5.03
- **Files:** `docs/playtests/m1.5.md`, `docs/adr/012-netcode-shape.md`
- **Verdict written 2026-09-20** (`docs/playtests/m1.5.md`), after the fact: PASS; ADR-012 carries the closing addendum. The measured netgraph numbers the done-when asks for were not recorded and are still owed by the next two-person session.
- **Do:** Re-run T-1.5.03's verdict across the internet instead of a LAN, conditioning off — the latency is now whatever the route gives, which is the entire point. Record measured RTT, jitter and loss from the netgraph beside each judgement so the verdict can be read against the NetSim cells T-1.22 asserts in CI. Where they disagree, the real link is right and the model needs revisiting.
- **Done when:** A written verdict at real internet latency with measured numbers beside it, and an ADR-012 addendum recording whether the two-human case changed that ADR's conclusion. **If it fails, stop and revisit ADR-012 before M2 continues** — the same rule T-1.24 carries, for the half of the question T-1.24 cannot reach.
- **Size:** S

**Exit gate:** T-1.5.08's verdict exists and is a pass. **Human sign-off confirmed 2026-09-19:** the owner completed the human-to-human internet gate and reports that it looks great. R2 closes here, not at T-1.24.

---

## 7. M2–M5 — Epics

Deliberately coarse. Each gets broken into leaf tasks at its planning gate,
using the T-1.xx tasks above as the template for granularity.

### M2 — Shooter feel (~8–10 wks)

| Epic | Scope | Notes |
|---|---|---|
| E-2.1 | Third-person camera | Spring arm, collision, shoulder swap, ADS transition · 🧍 |
| E-2.2 | Locomotion state machine & character presentation | Shared humanoid model/rig, blend tree, 8-way movement, crouch, vault |
| E-2.3 | Animation system | Aim offsets (additive), reload/fire layers, hit reactions, IK foot placement |
| E-2.4 | Weapon feel | Recoil patterns, camera shake, muzzle flash, tracers, shell ejection · 🧍 |
| E-2.5 | Projectile weapons | Grenades, RPG — ballistic arcs, network-replicated |
| E-2.6 | Downed & revive | Bleed-out timer, crawl state, revive interaction |
| E-2.7 | Combat audio | Positional Web Audio, weapon layers, distance falloff, occlusion approximation |

**Exit gate:** 🧍 A human plays a grey-box firefight and signs off that it feels good.

### 7.1 E-2.1 leaf tasks — broken out 2026-09-18

M1 closed on T-1.24's sign-off, so M2 is open and E-2.1 is first. Only E-2.1 is
broken out; the rest stay epics until their turn, per §0.5.

**What already exists.** T-0.06's QA passes built more of this epic than the
epic line suggests: a real orbiting camera with an 89-degree pitch limit
oriented by YXZ Euler rather than `lookAt`, over-the-shoulder offsets for hip
and ADS, pitch-based arm shortening, a floor clamp, an eased ADS field of view,
a first/third person toggle and a live tuning panel. E-2.1's remaining scope is
therefore narrower than "third-person camera": **spring arm, scene collision,
shoulder swap, and an ADS transition that moves more than the FOV.**

**§9 Q6 does not block this epic.** What fights back in M2 is a question about
encounters, not about the camera; answer it before any epic that needs a target
that shoots.

#### T-2.01 — Camera solve out of the render loop
- **Depends:** —
- **Files:** `packages/client/src/camera/cameraSolve.ts`, `packages/client/src/camera/cameraSolve.test.ts`, `packages/client/src/main.ts`
- **Do:** Move the third-person camera arithmetic out of `frame()` into a solve that takes the character's render position, yaw, pitch, ADS and config and writes camera position, focus, view direction and arm length into a caller-owned target. Plain numbers, no `three` types, so it runs headless — and so the renderer stays a view onto state (ADR-004). Compose the existing `solveArmLength` rather than reimplementing it. `main.ts` keeps the Euler set, the FOV ease and the assignment of the result.
- **Done when:** `pnpm verify` green, `main.ts` holds no camera arithmetic beyond applying the solve, and tests cover the behaviours the QA rounds established: shoulder handedness, pitch shortening, ADS distance scale, the floor clamp, and first person putting the camera exactly on the pivot.
- **Size:** M
- **Why first:** every remaining task in this epic changes that arithmetic, and while it sits inline in the render loop no test can reach it. Not itself part of E-2.1's scope — its prerequisite. Name the file `cameraSolve.ts`, not `FollowCamera.ts`: a name differing from the existing `followCamera.ts` only by case breaks on a case-insensitive filesystem.

#### T-2.02 — Spring arm
- **Depends:** T-2.01
- **Files:** `packages/client/src/camera/springArm.ts`, tests, `cameraSolve.ts`
- **Do:** Damp the arm length instead of snapping it every frame. **Asymmetric on purpose:** pull IN at once, ease OUT. A camera that eases inward clips through whatever it is avoiding for the length of the ease; one that snaps back out on clearing it reads as a jolt.
- **Done when:** tests assert the asymmetry — a step decrease in desired length is applied within one frame, a step increase takes a bounded number of frames — and that settle time is frame-rate independent, which a naive `lerp(a, b, k)` is not. Derive the thresholds from the smoothing constant; do not fit them (§2.3's habit, note 5).
- **Size:** S

#### T-2.03 — Arm collision against scenery
- **Depends:** T-2.02
- **Files:** `packages/client/src/camera/cameraColliders.ts`, `cameraSolve.ts`, `main.ts`, tests
- **Do:** Cast from the focus point toward the desired camera position, shorten the arm to the first hit less a margin that keeps the near plane clear of the surface, and let T-2.02's ease restore it. **State the set's rule where the set is built.** It is neither the shootable set nor "everything in the scene": it is static scenery the camera must not pass through — the distance posts, the rail, the reference figure, the ground. Other players are excluded, or the camera lurches every time a teammate walks behind you.
- **Done when:** tests drive the solve against a synthetic collider and assert the arm shortens to hit-minus-margin and recovers at T-2.02's rate; then built and driven headless, per the standing rule for anything the client renders.
- **Size:** M
- **Not T-1.12.** Camera collision is a local render concern and needs no authoritative collision. Finishing it must not be read as closing T-1.12's gap: a shot will still pass straight through a post that stops the camera, and the HUD should keep saying so.

#### T-2.04 — Shoulder swap
- **Depends:** T-2.01
- **Files:** `cameraSolve.ts`, `LocalInput.ts`, `main.ts`, `cameraConfig.ts`, tests
- **Do:** A key swaps the camera to the left shoulder, eased rather than cut. The aim convergence origin, the muzzle rig and the predicted tracer origin all follow the swap.
- **Done when:** tests assert the eye and muzzle offsets mirror with the side, and that a shot fired after a swap still converges on the reticle at **both near and far range — a 10:1 spread**, because an angular error is invisible at 10 m and glaring at 95 m (note 17).
- **Size:** M
- **The riskiest task in this epic.** Shots landing down-and-left, and then landing at an arbitrary range, were both caused by getting the aim convergence set or its precision wrong — a month apart in reasoning and ten minutes apart in time. Re-read note 16 and §2.3 before starting: the convergence set is exactly what the SERVER resolves hits against, and it is not the camera collider set this epic also introduces.

#### T-2.05 — ADS transition
- **Depends:** T-2.02, T-2.04
- **Files:** `cameraSolve.ts`, tests
- **Do:** Drive arm length, shoulder offset and FOV from one normalized transition parameter so they move together. Today only the FOV eases while distance and shoulder snap, so shouldering reads as a jump with a smooth zoom laid over it.
- **Done when:** tests assert all three are continuous across the transition, and that aim convergence stays consistent mid-transition — the frame where distance has moved and shoulder has not is exactly where a mis-derived eye position hides.
- **Size:** S

#### T-2.06 — Humanoid grey-box character
- **Depends:** T-2.05
- **Files:** `packages/client/src/character/humanoidPlaceholder.ts`, `packages/client/src/character/humanoidPlaceholder.test.ts`, `packages/client/src/main.ts`
- **Do:** Replace the local and remote capsule player representations with a recognizable, deliberately low-detail humanoid grey-box soldier built from simple Three.js primitives. Keep it as one reusable factory for every soldier: head, torso, pelvis, arms, legs, boots, a small backpack and a simple rifle silhouette. The root remains a hittable `THREE.Mesh` so the existing QA aim/tracer path can keep treating each player as one shootable object. This is a gameplay placeholder, not production art: no external asset, rig, skinning or new runtime dependency.
- **Done when:** the local player and every replicated remote player use the same humanoid factory, the capsule player geometry is gone from the playable characters, the placeholder reads as a human soldier at normal camera distance, and the factory has focused tests for its body-part structure and shared geometry/material ownership. `pnpm verify` remains green and the CHANGELOG records the task.
- **Size:** M

#### T-2.07 — 🧍 E-2.1 sign-off
- **Depends:** T-2.01, T-2.02, T-2.03, T-2.04, T-2.05, T-2.06
- **Files:** `docs/playtests/e2-1.md`
- **Do:** A human plays and judges camera feel: spring behaviour against walls and tight spaces, the shoulder swap, the ADS transition, and 89-degree pitch in both views.
- **Done when:** A written verdict exists, recording what it does and does not establish, as T-1.24's did.
- **Size:** S
- **Completed 2026-09-20.** Owner human sign-off passed. Camera, shoulder swap, ADS transition, and pitch were judged good enough for M2 to proceed.

### 7.2 E-2.2 leaf tasks — broken out 2026-09-20

E-2.2 is the next build epic after the completed E-2.1, E-2.4, and E-2.6 gates. The boundary is that this epic owns locomotion state and movement presentation; E-2.3 owns the broader animation stack (aim offsets, reload/fire layers, hit reactions, and IK). No general production art or full skeletal asset pipeline is pulled forward from M4. M2 does, however, pull forward one reusable, game-ready humanoid soldier model/rig so the locomotion work is validated on an actual character rather than the grey-box placeholder.

**What already exists.** CharacterController already owns authoritative walk, sprint, crouch and crawl speeds, jump, gravity, ground state and collision. LocalInput already produces movement axes, sprint/crouch/jump, yaw and the downed state. T-2.06 provides a shared grey-box humanoid for local and remote soldiers. E-2.2 therefore should not rewrite movement physics or introduce a second movement simulation. It should turn the existing movement state into a coherent visual state, and add vault only where the current step-up controller cannot provide the intended traversal.

**Two rules for this epic.** First, the server remains authoritative for movement and any new vault/crouch collision state; the client may predict only what the existing character controller already predicts. Second, the character presentation target is upgraded during this epic: the grey-box body remains the fallback/test fixture, but the M2 gate must exercise a reusable humanoid soldier model with a production-oriented rig. Build the state/pose interfaces so the model can replace the placeholder without changing the movement contract.

#### T-2.17 — Locomotion state model
- **Depends:** T-2.06, T-1.12
- **Files:** packages/client/src/character/locomotionState.ts, tests, packages/client/src/main.ts
- **Do:** Create a pure locomotion classifier driven by rendered movement velocity, grounded state, crouch/downed state and facing yaw. Produce explicit states for idle, walk, sprint, crouch-walk and crawl, plus an 8-way movement direction and normalized speed/phase inputs for the renderer. Do not duplicate CharacterController speed selection; consume its result.
- **Done when:** unit tests cover idle, all eight directions, walk/sprint thresholds, crouch, crawl, airborne and zero-speed edge cases; the classifier is deterministic and contains no Three.js types, DOM access or wall-clock reads. pnpm verify passes.
- **Size:** S

#### T-2.18 — Eight-way grey-box gait
- **Depends:** T-2.17
- **Files:** packages/client/src/character/locomotionPose.ts, tests, packages/client/src/character/humanoidPlaceholder.ts
- **Do:** Add a procedural placeholder gait for the grey-box soldier. Blend forward/back/strafe leg and arm poses across the eight movement directions, with a continuous gait phase so diagonal movement does not snap between cardinal poses. Walk and sprint use different stride magnitude/rate; idle settles exactly to the standing pose. Keep the implementation renderer-local and reusable by both local and remote soldiers.
- **Done when:** tests assert cardinal and diagonal poses are continuous at direction boundaries, gait phase is frame-rate independent, idle restores every affected part to its recorded rest transform, and local/remote factories can share the same pose driver. No production animation asset is introduced.
- **Size:** M

#### T-2.19 — Locomotion integration and remote playback
- **Depends:** T-2.18
- **Files:** packages/client/src/main.ts, packages/client/src/character/locomotionPose.ts, tests
- **Do:** Feed the classifier/pose driver from the same rendered positions already used by the camera and remote interpolation. Local prediction drives the local gait; replicated remote movement drives remote gait. Derive remote gait phase from continuous render time and movement state rather than adding a networked animation clock. Preserve existing remote interpolation and never mutate authoritative movement state from animation.
- **Done when:** a headless/browser harness can drive local movement through idle → walk → sprint → stop and a remote entity through the same sequence; both settle to the exact rest pose when stationary, and no animation update changes position, yaw, hitbox root or network state.
- **Size:** M

#### T-2.20 — Crouch presentation and authoritative height
- **Depends:** T-2.17
- **Files:** packages/shared/src/sim/CharacterController.ts, tests, packages/shared/src/net/lagComp.ts, packages/client/src/character/locomotionPose.ts, packages/client/src/character/humanoidPlaceholder.ts, packages/client/src/main.ts
- **Do:** Make crouch a real locomotion state rather than only a slower walk. Define standing and crouched controller heights in movement data/config, use the crouched height for authoritative movement clearance and lag-compensated hit volume, and have the placeholder body blend to a lower crouched pose. Keep crawl/downed geometry distinct: downed remains the T-2.14 pose and its existing hitbox contract. Client prediction must use the same crouch state and constants as the server.
- **Done when:** shared tests assert crouch height/clearance, standing↔crouch transitions, ceiling rejection and prediction parity; lag-comp tests assert the crouched hit volume differs from standing while downed keeps its existing contract; a browser test shows the body lowering without changing its shootable root identity. pnpm verify passes.
- **Size:** M

#### T-2.21 — Authoritative vault traversal
- **Depends:** T-2.20
- **Files:** packages/shared/src/sim/CharacterController.ts, tests, packages/shared/src/sim/world.ts, packages/shared/src/net/protocol.ts, packages/server/src/session/Session.ts, packages/client/src/main.ts
- **Do:** Add an explicit vault state to the shared movement contract for obstacles too high to step but low enough to vault. Detect a valid ledge from the same authoritative world boxes, require forward intent and grounded/near-grounded entry, and move the character through a fixed-duration traversal with no client-only teleport. The server owns whether a vault starts; the client predictor mirrors the same deterministic traversal from replicated/input state. Keep vault height, distance and duration in movement config, not hardcoded in the renderer.
- **Done when:** shared tests cover valid vaults, too-low step-through, too-high rejection, blocked landing, loss of forward intent, and frame-rate-independent traversal; a two-client session test shows the remote player vaulting from the same authoritative state without divergence beyond the existing movement bound. No vault can start while downed, dead, crouched, or firing.
- **Size:** L
- **Completed 2026-09-20.** `MoveState.vault` carries the whole traversal (entry facing, entry feet, obstacle top, elapsed), so the position at any moment is a closed form of elapsed time: 30 and 120 Hz trace the same path and land on the same tick of real time. Entry needs grounded, standing, not downed, not firing, no jump and forward-dominant intent; the obstacle is found one probe ahead among the shared boxes (taller than a step, no taller than `vaultMaxHeight`, rising from the ground), anything taller in the way refuses, and the landing footprint is checked for support and clearance before committing. Once under way every input is ignored. The vault rides the snapshot as a `Vault` component (protocol v10) so a reconcile mid-vault continues it rather than falling out; the trigger rides the input as a bit so the server can refuse a vault mid-burst and a Fire mid-vault. The parity harness's scripted walk now vaults a hurdle on every engine.

#### T-2.22 — Humanoid character model and rig integration
- **Depends:** T-2.19
- **Files:** packages/client/src/character/humanoidPlaceholder.ts, packages/client/src/character/, packages/client/src/main.ts, tests, docs/adr/ (only if a new runtime asset dependency is introduced)
- **Do:** Replace the grey-box soldier as the primary local/remote presentation with one reusable humanoid soldier model suitable for M2 playtesting. Establish a stable skeleton/rig contract for locomotion, crouch, crawl/downed and vault poses, and route the existing locomotion classifier/pose driver through that contract. Keep the grey-box implementation available as a lightweight fallback/diagnostic fixture. Do not build the general Blender → glTF production pipeline here; the asset must be committed or otherwise sourced under a documented license, and the runtime integration must use the existing Three.js asset-loading approach or add an ADR for any new runtime dependency.
- **Done when:** the browser harness renders the humanoid model for both local and remote soldiers; the model has a stable root/aim attachment and does not change authoritative position, yaw, hitbox identity or network state; locomotion state transitions can drive the rig without per-state renderer hacks; the grey-box fallback still passes its existing tests; and `pnpm verify` passes.
- **Size:** M
- **Completed 2026-09-20.** The soldier is a `SkinnedMesh` on a seventeen-bone skeleton built in code (`humanoidSoldier.ts`): primitives welded into one vertex-coloured geometry with rigid weights, GPU-skinned, one draw call plus the rifle where the grey box spent twelve. No asset was sourced: the model is the file, under the repo's licence, and no loader or runtime dependency was added, so no ADR. The rig contract (`humanoidRig.ts`) is what everything poses through: named bones (`HUMANOID_BONES`, the names a glTF soldier must carry to replace this one), an `aim` attachment on the chest that carries the rifle at the shared muzzle rig's shoulder, `base(bone)` for the transform a bone returns to in the current pose, and a `style` saying which gait layers the rig can carry. The bind pose is the identity, so poses are plain Eulers; the rifle hold is solved by two-bone IK at build time and is chest-relative, so the hands stay on the weapon through crouch and gait. The pose driver composes the gait on the pose's base — knees, hip bob, chest twist and lean on the skinned rig, whole-limb swing on the grey box — so a crouch-walk is the crouch with a gait on it and an idle crouch is exactly the crouch (which also fixes the grey box losing its crouch offsets on the first idle frame). The grey box implements the same contract and is drawn with `?greybox`. The hit root is unchanged: the same invisible capsule, raycast non-recursively, never moved by anything the rig does. Vault pose and blending are T-2.23's.

#### T-2.23 — Vault presentation and locomotion polish
- **Depends:** T-2.21
- **Files:** packages/client/src/character/locomotionPose.ts, packages/client/src/character/humanoidPlaceholder.ts, packages/client/src/main.ts, tests
- **Do:** Add the humanoid rig's vault pose and blend entry/exit with the locomotion state machine. The humanoid model is the primary presentation; retain the grey-box vault pose only as a fallback/diagnostic path. Preserve existing camera and weapon presentation contracts: vault changes the body pose and authoritative position, but does not create an alternate camera or firing path. Add small procedural anticipation/landing offsets only to visible parts.
- **Done when:** tests assert vault pose entry/exit restores exact standing/crouch rest transforms, local and remote vaults use the same state, and the weapon/aim root remains valid throughout. A browser harness records a complete step → vault → landing cycle with no visible pose snap.
- **Size:** M
- **Completed 2026-09-20.** The vault pose is a curve of the authoritative progress, not a clip with a clock of its own: the classifier gains a `vault` state fed by `vaultProgress` (the predicted `VaultState.elapsed` over `vaultSeconds` locally; the same replicated vault, now carried through the interpolation buffer as `vaultElapsed`, for remotes), and the pose driver turns that progress into the chest leaning over the obstacle, the lead leg lifting and coming down first, the trailing leg pushing off and following, on any rig (whole-limb lifts on the grey box). The driver blends: the gait is frozen and crossfaded into the vault over 0.12 s, crossfaded back into the live gait over 0.2 s, and a 0.22 s landing dip follows; every weight moves by dt. The driver measures its own largest per-frame joint rotation (`step`, `peakStep`) and the HUD prints it, which is how the harness records "no snap": through a browser step → vault → landing cycle at the headless ~20 fps, the largest per-frame joint turn over the vault was within 12% of the walk's own, and the resumed walk after landing within 25% (13 rad/s); a snap would be a radian in a frame. The camera and the weapon are untouched: the pivot follows the rendered feet as before, the aim attachment stays on the chest with the hands on it every frame, and Fire mid-vault is refused as in T-2.21. A crouch key held mid-vault poses standing until the landing, as the server does.

#### T-2.24 — 🧍 E-2.2 sign-off
- **Depends:** T-2.17, T-2.18, T-2.19, T-2.20, T-2.21, T-2.22, T-2.23
- **Files:** docs/playtests/e2-2.md
- **Do:** A human runs the grey-box range through idle, walk, sprint, all eight movement directions, crouch, jump, vault and crawl on the humanoid model. Verify the grey-box fallback separately. Test the same states on a second human over the deployed host. Judge whether locomotion reads naturally, direction changes do not snap, crouch is useful and readable, vault timing feels controllable, and remote movement remains visually believable.
- **Done when:** a written verdict exists, including any tuned movement/animation values and what the test does and does not establish. The verdict must pass before E-2.2 is complete.
- **Size:** S
- **Prepared 2026-09-20, not run.** `docs/playtests/e2-2.md` is the run sheet: the range's vault targets and hiding spots by position, the three HUD lines that are its instruments (the classifier's line, the stance line, and the pose-step peak that puts a number on "snap"), eight sections from the figure at rest through the eight-way gait, crouch, jump, vault, crawl and revive, the other person over the host under Poor and Awful, and the grey-box fixture, then tuning, netgraph and verdict sections left blank. It says NOT YET RUN at the top and stays that way until a person fills it in. The bots never shoot, so crawl, revive and remote believability need the second person, and the sheet says so. The movement panel gains crawl speed and the vault's seconds, distance and maximum height so that "vault timing feels controllable" can be tuned in the session rather than guessed at afterwards.

### 7.2 E-2.4 leaf tasks — broken out 2026-09-20

M1.5 closed on T-1.5.08 and T-1.12 is finished (a shared box world; ADR-005
addendum), so both answers §10 said M2 owed are in. E-2.1 is built and waits
on its human sign-off (T-2.07). The next epic broken out is E-2.4, not E-2.2:
weapon feel is what the owner is playtesting right now and needs no animation
system, while locomotion's blend tree does (E-2.3). Per §0.5, E-2.2, E-2.3
and the rest stay epics until their turn.

**What already exists.** T-1.17 owns cadence, magazine, seeded spread and
bloom, shared by client and server; the harness draws predicted tracers on
the trigger and the server's hit event lands the marker (`CombatQA.ts`). The
reticle's gap already shows the cone. T-1.12 made scenery stop shots, so a
hit event on netId 0 now carries a point of impact on a wall. What is
missing is everything a player FEELS on the trigger: the view kicking, the
camera shaking, a flash at the muzzle, a shell on the ground, and an impact
where the round stopped.

**Two rules that hold for every task here.** First, nothing in E-2.4 touches
the authoritative shot: recoil moves the VIEW, and the next shot's direction
comes from wherever the view then points, which the server already resolves.
A "recoil" that bent the server's ray would be a second spread and a second
parity requirement. Second, no art dependencies: every effect is primitives
and lines, pooled and capped like the tracers already are (§0.3 rule 3).

#### T-2.08 — Recoil patterns
- **Depends:** T-1.17, T-2.01
- **Files:** `packages/shared/src/sim/recoil.ts`, tests, `packages/shared/src/data/weapons.json`, `packages/client/src/input/LocalInput.ts`, `packages/client/src/weapons/CombatQA.ts`
- **Do:** Per-weapon recoil in data: a vertical kick per shot, a horizontal drift per shot with a seeded sign so a burst walks a repeatable pattern, a cap, and a recovery rate. A pure `recoil.ts` accumulates kicks and recovers them (exponential, frame-rate independent, the T-2.02 form). The client adds the accumulated offset to its view yaw/pitch — the aim the next shot is fired along — and the recovery pulls the view back only by what recoil added, never by what the mouse moved. ADS scales the kick down by a per-weapon factor.
- **Done when:** tests assert a burst of N shots produces the pattern in data exactly, that recovery returns the offset to zero within a bound derived from the rate, that the same recovery at 30 and 120 fps lands within 1e-6, and that mouse movement during recovery is preserved. Every weapon in `weapons.json` validates with the new fields.
- **Size:** M
- **Completed 2026-09-20.** `recoil.ts` lives in `packages/client/src/weapons/`
  rather than `shared`: it is view state the server never runs, and its
  recovery uses `Math.exp`, which §2.3 bans from the shared simulation. The
  data and its validation are in `shared` as specified. Fields are flat on
  `WeaponDef` (`recoilKickDeg` etc.) so the weapon panel's sliders reach them.

#### T-2.09 — Camera shake
- **Depends:** T-2.01
- **Files:** `packages/client/src/camera/cameraShake.ts`, tests, `cameraSolve.ts`, `main.ts`
- **Do:** A shot adds a small, decaying positional and rotational impulse to the camera — distinct from recoil, which moves the aim: shake is what the eye sees, and the reticle must NOT follow it, or the player is aiming with a shaking gun. Composed into the solve after the arm so collision is unaffected. Per-weapon magnitude in data; a `reduce` config for people who dislike it.
- **Done when:** tests assert the impulse decays to under 1% within a derived bound at any frame rate, that shake never changes `camSolve.direction` (the aim), and that two overlapping impulses sum rather than reset.
- **Size:** S
- **Completed 2026-09-20.** Written into separate `CameraSolve.shake` fields
  the renderer adds when placing the camera; `position`, `focus`,
  `direction` and `distance` stay untouched, and the aim ray is cast from the
  unshaken position, so the aim is unaffected by construction rather than by
  care. Per-weapon `shakePosM` / `shakeRollDeg` in data; `shakeScale` in the
  camera config with a slider (0 is off).

#### T-2.10 — Muzzle flash and shell ejection
- **Depends:** T-2.06
- **Files:** `packages/client/src/weapons/effects.ts`, tests, `CombatQA.ts`
- **Do:** On the trigger, a flash at the visual muzzle for two frames (a small emissive quad and a point light), and a shell — a tiny box — ejected right and back on a short ballistic arc that lands and fades. Both pooled and capped, exactly as tracers are, so a held trigger cannot leak the scene. The muzzle comes from `muzzlePosition` so it follows stance and shoulder.
- **Done when:** a headless run holding the trigger for five seconds ends with the pool at its cap and no per-shot allocation beyond it; the effect count returns to zero within the fade time after release.
- **Size:** M
- **Completed 2026-09-20.** `effects.ts`: every flash (additive sprite +
  point light) and shell (box) is allocated once and added hidden; a shot
  claims a free slot or recycles the oldest, so a held trigger never grows
  the scene. Shells fly a closed-form arc to an analytic landing time, so
  30 and 120 fps place them identically; the throw is seeded from the shot
  index. The lifetime bound is derived from the numbers. HUD shows the live
  counts against the caps.

#### T-2.11 — Impacts
- **Depends:** T-1.12, T-2.06
- **Files:** `packages/client/src/weapons/effects.ts`, `CombatQA.ts`, `main.ts`
- **Do:** Where a round stops, something happens. A scenery hit (a `HitEvent` on netId 0, from T-1.12) spawns a short spark burst and a fading decal-sized quad at the impact point on the wall; a player hit already lands the marker and adds a brief flinch on the humanoid. Predicted tracers end at the local raycast as now; the impact is drawn when the server confirms the point, which is the honest order.
- **Done when:** firing at the doorway wall from spawn produces an impact at the server's point every time, none at the tracer's predicted end when the two differ, and the pool stays capped under a held trigger.
- **Size:** S
- **Completed 2026-09-20.** `surfaceAt` (shared, pure) tells a scenery
  stop from a max-range miss by whether the server's point lies on a face
  of the shared world, since the hit event does not say; the tolerance is
  the wire's 1/64 m position step, because the point arrives quantized,
  and the mark is snapped back onto the face. The ground is not
  in the server's world, so it gets no mark, which is honest. Impacts are a
  decal quad turned onto the face plus seeded sparks on closed-form arcs,
  pooled and capped in `effects.ts`; a soldier hit jerks the upper body
  back and recovers to the exact resting pose. Only `onServerShot` calls
  `impact`; the predicted tracer's end is never used.

#### T-2.12 — 🧍 E-2.4 sign-off
- **Depends:** T-2.08, T-2.09, T-2.10, T-2.11
- **Files:** `docs/playtests/e2-4.md`
- **Do:** A human fires every weapon at the range and at another person, and judges whether recoil reads as a pattern to learn, whether shake is felt without being aimed with, and whether the flash, shells and impacts make a hit feel like a hit. Tune the new numbers in data while the feel is in hand.
- **Done when:** A written verdict exists, as T-1.24's did, naming what it does and does not establish.
- **Size:** S
- **Completed 2026-09-20.** Owner human sign-off passed. Recoil, camera shake, muzzle flash/shells, and impacts were judged good enough for M2 to proceed; the run sheet records the owner verdict.

### 7.3 E-2.6 leaf tasks — broken out 2026-09-20

E-2.4's build tasks are in and both remaining §10 items are human
sign-offs, so the next epic is broken out. **E-2.6 before E-2.2, E-2.3,
E-2.5 and E-2.7**, for three reasons. It is the squad pillar's own mechanic
(§1.2: revive ships in the slice, every class can do it), and the one thing
two humans in a room feel immediately: you go down, you crawl, your partner
picks you up. It is almost entirely shared simulation and server state,
which is what the project builds well and tests exactly; E-2.2 and E-2.3
both wait on an animation system and a rig, and E-2.7 on audio assets. And
it needs no new world: T-1.12's cover is enough to get downed behind.

**What already exists.** T-1.19 owns health, zones, death and the 5 s
respawn (`damage.ts`), replicated in the `Health` component and shown on
the HUD. The character controller has walk, sprint and crouch speeds. The
predictor replays inputs, so any gait the server imposes must be one the
client can impose on itself from replicated state, or every tick is a
correction.

**Two rules for every task here.** First, vitality is the SERVER'S: nothing
predicts a down, a death or a revive (§2.3 puts damage on that side of the
line), and the only thing the client predicts is the crawl gait, from the
replicated state, because movement is predicted. Second, no art: a downed
soldier is the grey-box humanoid laid down, a revive is a held key and a
progress number on the HUD.

#### T-2.13 — Downed state, bleed-out, crawl
- **Depends:** T-1.19, T-1.12
- **Files:** `packages/shared/src/sim/damage.ts`, `data/damage.json`, `CharacterController.ts`, `ecs/components.ts`, `net/schema.ts`, `net/protocol.ts`, `Session.ts`, `NetClient.ts`, `main.ts`, tests
- **Do:** Health reaching zero DOWNS rather than kills: a `downedAt` beside `diedAt`, three vitalities in one order (alive, downed, dead, respawn). A bleed-out timer in data; damage to a downed soldier cuts the timer in proportion (one health bar finishes it) rather than touching health, so a squad can finish someone and a downed player under fire is not safe. The controller gains a crawl speed and a `downed` input flag that the server sets from vitality and the client predictor from the replicated one; sprint and jump are ignored under it. A downed or dead soldier cannot fire, server and client. The `Health` component carries the vitality and the whole seconds left in its phase (protocol v7), so the HUD counts what the server counts instead of timing from the first zero it saw.
- **Done when:** tests assert the down at the exact threshold and never a kill from health; bleed-out into death at the configured time and the respawn counted from death; proportional cutting and an early finish; revive restoring the configured fraction (the pure function, for T-2.15); crawl speed and no jump; end to end over the wire, that a downed body takes hits for zero and respawns after bleed-out plus respawn, and that a downed client's Fire is ignored. Every fixture declares its own numbers.
- **Size:** M

#### T-2.14 — Downed presentation
- **Depends:** T-2.13, T-2.06
- **Files:** `packages/client/src/character/humanoidPlaceholder.ts`, `cameraSolve.ts`, `main.ts`, tests
- **Do:** A downed humanoid lies on its back (the root turned, the hit capsule still the server's: the server's hitbox does not change shape when downed, and neither must the client's shootable root). The local camera drops to a crawl height while downed, eased, and the reticle hides since there is no weapon in hand. Remote downed soldiers show the same pose from replicated vitality. The HUD line from T-2.13 becomes a clear DOWNED banner with the countdown.
- **Done when:** tests assert the pose is applied from vitality and restored exactly on revive or respawn, and that the shootable root's geometry is untouched by the pose; a headless run downs the local player and screenshots the view.
- **Size:** S
- **Completed 2026-09-20.** `setHumanoidPose` turns the PARTS about the root and drops them to a lying height; the root, which is the hit capsule, is untouched, and `standing` restores every part's rest transform exactly. The camera's pivot eases to `downedEyeHeight` on the same exponential curve as the other blends. Remote vitality rides the snapshot and drives the remote pose; the reticle hides and a banner counts the server's bleed-out. A downed soldier no longer flinches: they are already on the ground.

#### T-2.15 — Revive interaction
- **Depends:** T-2.13
- **Files:** `net/protocol.ts` (a button bit), `Session.ts`, `NetClient.ts`, `LocalInput.ts`, `main.ts`, tests
- **Completed 2026-09-20.** E is carried as an input bit; the server authoritatively locks the first nearby living reviver to a downed teammate, advances the configured 3 s hold, resets on release/range/invalid state, and calls the existing T-2.13 `revive`. Revive progress and reviver net ID are replicated in Health snapshots, and both HUDs display the teammate name and progress. Protocol is v8 for the extended Health schema. Session tests cover completion, release/lock handoff, range reset, dead targets, and bleed-out winning when the attempt starts too late.
- **Done when:** a two-client session test downs one, walks the other into range, holds the button for the configured time and sees the revive; releasing early resets; out of range resets; a dead soldier cannot be revived; the bleed-out keeps running during the attempt (a revive that arrives too late fails honestly).
- **Size:** M

#### T-2.16 — 🧍 E-2.6 sign-off
- **Depends:** T-2.13, T-2.14, T-2.15
- **Files:** `docs/playtests/e2-6.md`
- **Do:** Two people on the host. One goes down behind cover and crawls; the other revives them under fire, and once fails to in time. Judge whether the bleed-out is long enough to reach a teammate and short enough to matter, whether being finished reads as fair, whether the revive hold feels earned, and whether the downed view is clear about what to do. Tune `damage.json`'s downed block while the feel is in hand.
- **Done when:** a written verdict, on a run sheet prepared before the session as `e2-4.md` was.
- **Size:** S
- **Completed 2026-09-20.** Owner human sign-off passed. Downed presentation, crawl, bleed-out, and teammate revive were judged good enough for M2 to proceed.

### 7.4 E-2.3 leaf tasks — broken out 2026-09-20

E-2.2's build tasks are in and its only open item is the human gate
(T-2.24), so the next epic is broken out. **E-2.3 before E-2.5 and E-2.7**,
for three reasons. T-2.22 built the rig it was waiting for: a skeleton with
named bones, a chest-mounted aim attachment the hands are solved onto, and a
pose driver that layers on a pose's base and restores it exactly — the
animation system is the layers that go on top of that, and nothing else in
M2 can use the rig until they exist. It is what the exit gate's firefight
reads through: a soldier who aims where they look, whose rifle kicks when
they fire, who visibly reloads, who reacts to being hit, and whose feet
stand on what they stand on; today a remote soldier holds a level rifle
whatever they are looking at. And it is almost all client-side arithmetic on
the rig: the aim pitch is already on the wire (the `Transform` component has
carried it since T-1.17 for the server's own shots), shot events already
reach every client, and the one new replicated thing (a reload in progress)
is a few bits. E-2.5 needs a target that shoots (§9 Q6) and a new class of
replicated entity; E-2.7 needs audio assets.

**What already exists.** The rig contract (`humanoidRig.ts`): named bones,
`base(bone)` for the transform a bone returns to in the current pose, the
`aim` attachment on the chest, `flinchParts`, and the grey box as a second
implementation. The pose driver (`locomotionPose.ts`) composes the gait and
the vault on the base and measures its own largest per-frame joint step. The
two-bone IK that puts the hands on the rifle at build time
(`humanoidSoldier.ts`). The `ServerShot` event with shooter, target, point
and damage on every client. `Transform.pitch` on the wire. The interpolation
buffer carrying stance and vault beside position. `supportUnder` in the
shared world for what is under a point. The T-2.11 flinch, a translation of
the upper body that this epic replaces with a rig reaction.

**Three rules for every task here.** First, **a layer is additive on the
pose driver's output and restores exactly**: applied after the gait every
frame, in the rig contract's terms (named bones, base transforms), zero
input leaves the bones bit-identical to the driver's, and no layer
accumulates across frames. Second, **nothing authoritative moves**: not the
hit capsule, not the aim the server traces, not the muzzle the tracers
leave. A layer is a picture of state that already exists; where a remote
needs a piece of state it does not have, replicate the state, never an
animation clock. Third, **no animation assets**: every layer is procedural,
as the gait and the vault are; the clip pipeline is M4's, and a rig that
animates from state now will take clips then.

#### T-2.25 — Aim offsets (additive)
- **Depends:** T-2.22, T-2.23
- **Files:** `packages/client/src/character/humanoidRig.ts`, `humanoidSoldier.ts`, `humanoidPlaceholder.ts`, `packages/shared/src/net/interpolate.ts`, `packages/client/src/net/NetClient.ts`, `main.ts`, tests
- **Do:** The rig contract gains `aim(pitch, weight)`: pitch the weapon and what holds it to a signed aim pitch, additive on the current pose. On the skinned soldier the spine takes a bounded share of the pitch, the neck follows so the head looks along the aim, the aim attachment turns about the shoulder by the remainder so the rifle points exactly along the aim, and the arms are re-solved onto the turned grips every frame by the same IK that placed them at build time; at pitch zero every bone is bit-identical to the driver's output. The grey box turns its rifle part. Locally the pitch is the view pitch the player sees (recoil included, so the body kicks with the view); for remotes it is the replicated `Transform.pitch`, carried through the interpolation buffer like yaw. The weight fades the layer out through a vault and off when downed.
- **Done when:** tests assert the aim attachment's forward matches the pitch within a degree and a half across the camera's whole range, the hands stay on their grips throughout (within reach; the layer never leaves a hand floating), pitch zero restores the exact standing and crouched rest, weight zero at any pitch is the base, a walk with the layer applied every frame equals a walk without it once the pitch returns to zero (no accumulation), the root never moves, the interpolation buffer lerps pitch the short way and reads absent pitch as level, and local and remote fed the same pitch strike the same pose. A browser run on the host shows the other player's rifle pitched when they look up.
- **Size:** M
- **Completed 2026-09-20.** `aimAt(pitch, weight)` on the rig contract. On the skinned soldier the spine takes 30% of the pitch to a 0.35 rad cap, the neck 35% to 0.45 rad, and the aim attachment turns about the shoulder by the remainder, so the rifle's pitch in the body's frame is the aim's exactly; the arms are re-solved onto the turned grips every frame by the same function that placed them at build time, composed on the rest the way the pose is, so a level aim is the pose's own bits (the sign of a zero counts). The neck, which the driver writes, is composed on with an undo-if-untouched guard so a frame with no time in it cannot stack the layer; the spine, which nothing else rotates, is set from its base. A pose change re-bases the attachment. The grey box turns its rifle part. Locally the pitch is the view pitch the player sees, recoil included; remotes get `Transform.pitch` through the interpolation buffer, lerped the short way, absent reading as level. The weight is one minus the driver's vault weight, and zero while downed. Two browsers on a host: the other player's rifle pitched steeply up on the watcher's screen while the bots' stayed level.

#### T-2.26 — Fire and reload layers
- **Depends:** T-2.25
- **Files:** `packages/client/src/character/`, `packages/shared/src/ecs/components.ts`, `net/schema.ts`, `net/protocol.ts`, `Session.ts`, `NetClient.ts`, `main.ts`, tests
- **Do:** Fire: each shot kicks the aim attachment back and up and the chest with it, recovering exponentially and frame-rate independently (the T-2.02 form), stacking under a held trigger as the camera shake does; locally from the predicted shot, for remotes from the `ServerShot` event by shooter. Reload: a `Weapon` component carries the weapon index and reload progress (protocol bump), and the reload is a curve of that progress, as the vault is of its own: the left hand leaves the foregrip for the magazine well and returns, the rifle dips, and at the end the hands are back on their grips exactly; locally from the client's own reload state, for remotes from the replicated progress.
- **Done when:** tests assert the kick recovers within a bound derived from its rate and traces the same envelope at 30 and 120 fps, that a burst builds and is bounded, that the reload's hands return to the grips bit-exactly, that local and remote fed the same progress strike the same pose, and a session test replicates a reload's progress to a watcher. No layer moves the tracer's muzzle or the shot the server resolves.
- **Size:** M
- **Completed 2026-09-21.** The rig contract's `hold(state)` takes the whole weapon layer in one pass: the aim (T-2.25), the fire layer's kick and the reload's progress, so the hands are solved onto the rifle wherever all three have put it; `aimAt` is `hold` with only the aim. The kick (`weaponKick.ts`, the T-2.09 form) drives the rifle back along its own axis and its muzzle up by the weapon's `recoilKickDeg` in data, scaled by `recoilAdsScale` when aimed, recovers on one exponential, and stacks under a held trigger to the geometric bound; the spine takes a share so the body takes the shot. Locally it fires on the predicted shot; for a remote, on the server's shot event by shooter, with the weapon they hold read from the new `Weapon` component (index and reload percentage, protocol v11). The reload is a curve of the weapon's own clock (`reloadProgress` in shared, used by the server's snapshot and the client's own state alike): the muzzle dips and the left hand leaves the foregrip for the magazine well and returns, bit-exact on the grips at both ends. The server replicates only the reloads it starts itself (an empty magazine on a Fire); a client's manual reload is its own picture. A browser run: the rifle kicked through a held burst and the left hand was at the magazine well through the auto-reload, back on the foregrip after. The tracer's muzzle and the shot the server resolves are untouched.

#### T-2.27 — Hit reactions on the rig
- **Depends:** T-2.25
- **Files:** `packages/client/src/character/`, `packages/client/src/weapons/effects.ts`, `main.ts`, tests
- **Do:** Replace the T-2.11 translation flinch on the skinned rig with a reaction in the rig's terms: the chest turns away from the shooter (the direction is known on every client from the shot's shooter and the target's position), the head snaps on a head-zone hit (the zone from the point's height against the same fractions `damage.json` uses), the magnitude scales with damage, it recovers on the T-2.02 curve, a second hit restarts it, and a downed soldier does not react. The grey box keeps the translation flinch as its fallback path; `effects.flinch` becomes the entry point that asks the rig.
- **Done when:** tests assert direction (a shot from the left turns the chest one way, from the right the other), zone (head hit moves the head, torso hit does not), magnitude, exact recovery, restart without drift, none while downed, and the grey box unchanged; the T-2.11 flinch tests keep passing on the fixture.
- **Size:** M
- **Completed 2026-09-21.** `react(reaction)` on the rig contract, a layer on the same rules as `hold`: applied after the driver, never accumulating, and handing the bones back exactly on `react(null)`. The chest turns away from the shooter about its own up axis and tilts along the shot — back from a round in front, forward from one behind — and on a head-zone hit the head snaps 1.6× that again on top, so it goes further and faster than the body under it. The chest is the driver's to write, so the layer composes on it with the T-2.25 undo-if-untouched guard; the head, which nothing else rotates, is set from its base. The numbers are pure and live in `hitReaction.ts`: `shooterDirection` puts the shooter in the target's own frame from state every client already has (the shot's shooter and both positions — nothing new on the wire), `hitReactionFrom` scales by damage to a bound at `REACTION_FULL_DAMAGE` and reads the zone from the impact's height against `damage.json`'s own fractions, and `reactionAt` is the T-2.02 curve as a closed form of the age, so 30 and 120 fps trace the same recovery and a second hit is a new peak rather than a sum. `effects.flinch` is now the entry point that asks the rig — `react(null)` with nothing live is the question — and falls back to the T-2.11 translation over `flinchParts` for the grey box, which answers false and keeps its jerk back; the skinned soldier names no parts to translate. A downed soldier does not react. The muzzle the tracers leave and the shot the server resolves are untouched.

#### T-2.28 — Foot placement
- **Depends:** T-2.25
- **Files:** `packages/client/src/character/`, `main.ts`, tests
- **Do:** Each foot finds what is under it in the shared world (`supportUnder` at the foot's own x/z) and, when that differs from the body's authoritative feet height, a two-bone leg IK plants the foot on its support within a bounded range, the hips settle to the lower foot, and the other knee bends to take up the difference; blended by dt so stepping onto and off an edge slides rather than pops; only while grounded and not vaulting or downed; never a change to the authoritative position. The gait's swing stays on top: a planted foot is the one the gait has on the ground.
- **Done when:** tests assert a soldier standing half on the slab has one foot at the slab's height and one on the ground with the hips lowered and a knee bent, flat ground is the exact rest, the range is bounded, a walk across the slab's edge keeps the peak joint step inside the walk's own, and the root never moves; a browser run screenshots a soldier standing on the slab's edge.
- **Size:** M
- **Completed 2026-09-21.** `footPlacement.ts`: a driver on the rig contract, as the gait is, applied after it every frame. Each foot asks `supportUnder` at its own x/z — the shared world, the same list the controller collides with — for an offset from the body's authoritative feet height, bounded to `FOOT_RANGE_M`; the hips settle to the LOWEST foot, since a leg that rests straight cannot reach below the hips it hangs from, and every other knee bends to put its foot back down through the same two-bone solver that puts the hands on the rifle, now shared as `twoBoneIk.ts` (the arms' pose is bit-identical after the move). The ankle keeps the world orientation the gait gave it. The gait stays on top: the IK's target is where the gait put the foot, its pole hint is a fixed distance ahead of where the gait put the knee (a standing leg's knee sits on the hip-to-ankle line, where the perpendicular the solver needs is noise and two frames can bend the same leg two ways), and a foot the gait has LIFTED is not planted at all — each foot's share fades out with its lift above the same foot in the pose's own base, so only a foot the gait has on the ground is pinned to the world. The settle is a critically damped spring rather than an exponential, because the knee's bend grows as the square root of the lift and an exponential's first frame is its fastest: from a straight leg that is most of a radian in one frame, which is the vault's snap in the one shape it can still take. The layer fades in over its first two centimetres, since IK cannot reproduce the gait's own bits even when asked for the pose it is already in. Off while vaulting or downed, which the caller says, and off while airborne, which the layer works out from the body's own footprint. The root is never touched. Measured: a walk across the slab's edge peaks at 0.168 rad of joint step against the walk's own 0.168 at 60 fps, and 0.328 against 0.329 at 30. A browser run on the published harness: the soldier on the slab's west edge with the HUD reading `feet at 7.5,8.0  L 0.00  R -0.40  hips -0.40`, one boot on the slab, one on the ground, the hips down between them; walking back off it returned exactly `L 0.00  R 0.00`.

#### T-2.29 — 🧍 E-2.3 sign-off
- **Depends:** T-2.25, T-2.26, T-2.27, T-2.28
- **Files:** `docs/playtests/e2-3.md`
- **Do:** Two people on the host. Each watches the other aim up and down, fire bursts, reload, take hits, and stand on the slab's edge, and judges whether the body reads what the other is doing: is the rifle pointing where they are looking, does a burst look like a burst, does a reload read as one without a HUD, does a hit land on the body, do the feet stand on the world. Tune the layers' numbers while the feel is in hand.
- **Done when:** a written verdict, on a run sheet prepared before the session as `e2-2.md` was, naming what it does and does not establish.
- **Size:** S

### 7.5 E-2.5 leaf tasks — broken out 2026-09-21

E-2.3's build work is in (T-2.25 through T-2.28) and its only open item is the
human gate, so the next epic is broken out. **E-2.5 before E-2.7**, for two
reasons. E-2.7 needs audio assets nobody has sourced, which is R1 and §9 Q2,
and buying them to hear a rifle is a decision about the project's largest cost
made for the smallest reason. And E-2.5 no longer needs what it was waiting
for: §7.4 held it back because it wants "a target that shoots" (§9 Q6), and
M1.5 answered that with the other person on the host. A grenade is the first
weapon here whose whole point is that it is thrown *at* somebody who can walk
away from it, so a human on the other end is not a nicety, it is the test.

**What already exists.** The shared world of axis-aligned boxes and `rayWorld`
against it (T-1.12) — one list that the controller, the server's shots, the
camera arm and now a grenade all collide with. The table trig and the seeded
PRNG (T-0.14). `damage.json`'s zones and the downed/bleed-out machine (T-2.13,
T-2.15), which a blast can feed without changing a line of it. Delta spawns
and despawns (T-1.04), supported since M1 and exercised by nothing: the six
slots have always existed and never appeared or vanished. A grenade is the
first entity in this game that does either.

**Four rules for every task here.**

1. **The server throws it.** A projectile is a replicated entity, never a
   predicted one (§2.3). The client may draw the arc it expects; where the
   thing actually is, when it goes off and who it hurts are the server's, and
   a client that disagrees is simply wrong.
2. **One integrator, one world.** The arc a thrower is shown is the same
   function stepping at the same dt over the same box list the server flies the
   real one along. A prettier preview from a second integrator is a picture of
   a throw that is not going to happen, and the player aims by that picture —
   this is `world.ts`'s one-list rule, applied to the one case where the
   disagreement is visible before the shot lands.
3. **Pure arithmetic, no Rapier.** ADR-005's 2026-09-19 addendum names
   projectiles as Rapier's. That is amended here (ADR-005 addendum,
   2026-09-21) rather than quietly ignored, per §0.2: a sphere against boxes
   with gravity, restitution and friction is exact on every engine and keeps
   WASM out of the preview path. Ragdolls and debris stay Rapier's.
4. **No new assets.** A grenade is a sphere, a rocket is a stub of a cylinder,
   and a blast is pooled primitives on a closed form of their age, exactly as
   T-2.10's flash and shells are. The clip and effect pipelines are M4's.

**Not in this epic.** Cooking a grenade in the hand, an underbarrel launcher,
smoke and flashbangs (M4 content), destructible cover (nothing in the world
model can break), and any AI that throws one (M3). The blast damages everyone
it reaches, the thrower included: with six co-operative slots and nothing
hostile in M2, a grenade that could not hurt a teammate could not be judged at
all.

#### T-2.30 — Ballistic arcs in the shared sim
- **Depends:** —
- **Files:** `packages/shared/src/sim/ballistics.ts`, `packages/shared/src/data/projectiles.json`, `packages/shared/src/sim/world.ts`, `packages/shared/src/index.ts`, tests
- **Do:** Projectile definitions as data, validated at import as `weapons.json` is: launch speed and loft, gravity and drag, collision radius, restitution, bounce friction and roll drag, fuse, impact detonation, blast radius, damage and edge fraction. Behaviour as pure functions of (definition, state, dt, world): a step that integrates the parabola and SWEEPS the projectile's sphere along the chord it travelled, bounces off the face it struck, settles and skids on a floor, and reports the step it goes off on and why (fuse, impact, old age). `rayWorld` gains the two things a bounce needs and a ray never did — an inflation radius, which turns it into a swept sphere, and the face normal it entered through. A blast is falloff by distance from a flat core to an edge fraction, scaled by how much of a target the blast can see through the same box list.
- **Done when:** tests assert the arc matches the closed-form parabola in clear air, that a re-run is bit-identical, that a rocket at 45 m/s cannot pass through a 2 cm wall at 12 m, that a bounce returns the restitution's share of the approach speed and reverses the axis it struck, that a dropped grenade comes to rest and then does not move at all, that a flat hard throw skids on after landing rather than sticking where it touched, that the fuse ends it wherever it is and an impact fuse ends it on the surface it hit, that the blast falls off monotonically and stops at its radius, that cover blocks the probes it should and not the ones it should not, and that the previewed arc is the stepped path to the last bit.
- **Completed 2026-09-21.** `ballistics.ts`, and `projectiles.json` beside `weapons.json`: a frag grenade and a rocket. The step integrates the parabola — `p + v·dt - ½g·dt²`, the closed form the shells in `effects.ts` already fly — and collides the straight chord between its ends, swept as a sphere by `rayWorld`'s new `inflate`, so a 45 m/s rocket cannot cross a 2 cm sheet without touching it. A bounce takes the entry face's normal (also new on `rayWorld`, and free: the slab test already knew it), gives back `restitution` of the normal speed and sheds `friction` of the tangential. Three things the first draft got wrong and the tests caught: a dead bounce on a floor is a LANDING, not a bounce — without that branch a grenade thrown flat spent its whole collision budget on zero-distance contacts and stopped dead where it touched, so a settled projectile is held up by the floor and skids for the rest of the tick; a skid needs its own rate (`rollDragPerSec`) rather than the bounce's fraction, which at 30 Hz stops a grenade in a tenth of a second; and an arc walked by comparing a running total against its horizon draws one frame too many, because fifteen thirtieths is 0.49999999999999994. The blast is linear from a flat core (a tenth of the radius) to `blastMinFraction` at the edge, scaled by three probes up the target — shin, chest, head — through the same box list, with `blastCoverFraction` as the floor for a body entirely behind something: a soldier hugging a 0.9 m crate keeps their head exposed and takes a third of the sight. Level throws travel about 17 m including the roll; the rocket reaches 43 m before its sag puts it in the ground. Nothing here reads a clock, and a re-run is bit-identical.
- **Size:** M

#### T-2.31 — Projectiles on the wire and on the server
- **Depends:** T-2.30
- **Files:** `packages/shared/src/net/protocol.ts`, `packages/shared/src/ecs/components.ts`, `net/schema.ts`, `packages/shared/src/net/Connection.ts`, `packages/server/src/session/Session.ts`, tests
- **Do:** A `Throw` message (a trigger pull for a projectile: tick, aim, which one), reliable like `Fire`, and everything in it untrusted — the index is bounds-checked, the pouch and the cooldown are the server's. The session spawns a projectile entity with a netId of its own, steps every one of them once per tick with T-2.30's stepper, and replicates position and velocity through the existing snapshot path plus a `Projectile` component saying which kind it is and whose it is (protocol bump). On detonation it despawns, applies blast damage to every soldier in reach through `applyDamage` — the thrower included — and broadcasts a `Detonation` carrying the point, the tick it happened on and what each target took. A rocket also detonates on the first body it touches, tested against the hitboxes as they are NOW: a projectile is a real object in the present, not a rewound ray, so lag compensation has no part in it.
- **Done when:** session tests over the real wire, decoding the deltas a client would decode, assert a thrown grenade appears as an entity that spawns, moves and despawns; that it goes off on its fuse, that the blast is stamped with the tick of the snapshot the projectile vanishes from, and that it damages a soldier standing next to it and nobody across the range; that the thrower takes their own blast and is downed by the same `applyDamage` a bullet uses; that a rocket fired at a teammate detonates on them rather than behind them; that the pouch empties and the cooldown holds, so a client spamming Throw gets exactly what the data allows; that a downed or vaulting soldier throws nothing and a respawn refills the pouch; and that a projectile's netId is never a slot's or a range target's. What a blast does at a distance and through cover stays in `ballistics.test.ts`, over geometry a fixture owns rather than the shipped world.
- **Completed 2026-09-21.** A `Throw` message beside `Fire` — same shape, same untrusted treatment, and no rewind: a hitscan shot is resolved against the world its shooter was looking at, while a grenade is an object in everyone's present, so spawning it in the past would only put it where nobody will see it. The session keeps a list of them (the first entities here that come and go), flies each one tick with T-2.30's stepper, and replicates `Transform`, `Velocity` and a new `Projectile` component saying which kind and whose (protocol v12). They fly LAST in the tick, after the bodies have moved and been recorded and after the tick has advanced, so a rocket meets the soldiers where this tick left them and a `Detonation` names the tick of the snapshot it despawns from. A rocket also goes off on the first body along its step, tested against the capsules as they stand now rather than through lag compensation, its own thrower excepted — though the blast still reaches back, which is what firing one at arm's length should cost. The blast runs through `applyDamage` like a bullet's, so it downs, cuts a bleed-out and cannot kill twice, and it catches everyone in reach including the thrower: with nothing hostile in M2, a grenade that could not hurt a teammate could not be judged at all. Two things fixed on the way: `isRangeTarget` was "anything at or above 1000" and would have called every projectile a range target, so it is now a bounded test; and `applyFire` stored a Fire's TABLE-unit pitch in the slot's WIRE-unit field, so the aim pitch a remote's rifle points along (T-2.25) was masked to nonsense for the tick after every shot.
- **Size:** M

#### T-2.32 — The throw in the page
- **Depends:** T-2.31
- **Files:** `packages/client/src/weapons/ThrowQA.ts`, `packages/client/src/net/NetClient.ts`, `packages/client/src/input/LocalInput.ts`, `packages/client/src/main.ts`, tests
- **Do:** Hold the throw key to see the arc, release to throw it. The preview is T-2.30's `projectileArc` from the eye along the converged aim, drawn as a line with a marker where it would go off, and it is the same call the server will make. The pouch is two projectiles on 5 and 6 with their counts on the HUD, mirroring the local weapon state the way `CombatQA` mirrors the weapon's. Replicated projectiles are drawn from the interpolation buffer at the same delay as remote soldiers, since that is the world they are in; the local thrower gets a predicted ghost from the same stepper so their own grenade leaves their hand now rather than a round trip later, retired the moment its replicated twin arrives.
- **Done when:** tests assert the preview line is `projectileArc`'s own points, that the throw key latches a release edge the way the trigger latches a press so a tap is never lost, that the pouch and its cooldown refuse what the server would refuse, that a ghost flies on the same stepper the server flies its twin on, and that the ghost/twin handover shows exactly one grenade — bound on arrival, the twin hidden while the ghost lives, the ghost retired when the twin leaves the world, never adopting somebody else's throw and never going off by itself. A browser run on the host: the other player sees the grenade you threw follow the arc you were shown, and it goes off where it landed.
- **Completed 2026-09-22.** Hold G to see the arc, release to throw it; 5 and 6 pick from the pouch beside 1–4's weapons, and the netgraph moved to N, since G is the more valuable muscle memory. `ThrowQA` is the local copy — pouch, cooldown, arc, ghosts — with no THREE in it, so the sequencing is testable in Node and `main.ts` only draws. The preview is `projectileArc` itself over `{ DEFAULT_WORLD, config.groundY }`, the same function over the same list the server flies the real one through, from the same clamped launch origin; it is drawn into a fixed buffer with a draw range rather than a new geometry per frame. The handover is by BINDING, not by timing: a ghost leaves the hand on the release, the replicated twin is matched to it by kind and owner slot when it arrives, the twin is not drawn while its ghost lives, and the ghost is retired the moment the twin leaves the world — so there is one grenade on screen throughout, it leaves immediately, and the blast stays the server's. A ghost never detonates itself; one whose throw went unanswered gives up after 1.2 s. On the wire side `NetClient` keeps projectiles in their own buffers (a grenade handed to `remotes()` would be given a humanoid mesh, a pose driver and a foot solver), interpolated at the same delay as everything else replicated, and holds each `Detonation` until the render clock reaches its tick.
- **Size:** M

#### T-2.33 — Detonation presentation
- **Depends:** T-2.32
- **Files:** `packages/client/src/weapons/effects.ts`, `packages/client/src/camera/cameraShake.ts`, `packages/client/src/main.ts`, tests
- **Do:** A blast is a flash, an expanding shell of light, debris thrown on the same closed-form arcs the shells fly, and a scorch on the ground under it — pooled once and capped like every other effect, and stateless per frame so 30 and 120 fps draw the same picture at the same moment. It shakes the camera by distance, scaled the way the blast damage is and cut by the same cover the damage is cut by, so a blast behind a wall is felt less than one in the open. The server's `Detonation` is held until the render clock reaches the tick it happened on, because the projectile is being drawn a hundred milliseconds behind server time and a blast that arrives early goes off in front of a grenade still in the air. Each target's own damage lands as the T-2.27 reaction, away from the blast.
- **Done when:** tests assert the shake falls off with distance and is zero past the radius, that cover cuts it, that a detonation is not drawn before its tick is being rendered and is drawn exactly once when it is, and that the effect pools never grow. A browser run: two grenades in a burst allocate nothing, and the blast reads from across the range.
- **Size:** M

#### T-2.34 — 🧍 E-2.5 sign-off
- **Depends:** T-2.30, T-2.31, T-2.32, T-2.33
- **Files:** `docs/playtests/e2-5.md`
- **Do:** Two people on the host. Each throws grenades at the other and at cover: does the arc read where it is going, does the grenade land where the line said, does a bounce off a crate go where a bounce should, does a blast behind cover feel weaker than one in the open, and is the rocket worth the two rounds it carries. Tune the numbers in `projectiles.json` while the feel is in hand.
- **Done when:** a written verdict, on a run sheet prepared before the session as `e2-2.md` was, naming what it does and does not establish.
- **Size:** S

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

### M4 — Content systems (~9–11 wks)

| Epic | Scope |
|---|---|
| E-4.1 | Asset pipeline — Blender → glTF → gltf-transform (Draco + KTX2) → manifest |
| E-4.2 | Runtime asset loading, streaming, LOD, budget enforcement in CI |
| E-4.3 | Level format + modular kit (~60 pieces) + lightmap bake |
| E-4.4 | Mission scripting — objectives, triggers, spawners, scripted events |
| E-4.5 | Matchmaking, parties, region selection, reconnect-to-session, invite flow — **rooms, join codes and the lobby moved to M1.5** (§4.2) |
| E-4.6 | Persistence — accounts, campaign saves, per-soldier XP (Postgres + Redis) |
| E-4.7 | HUD, menus, class selection, scoreboard |
| E-4.8 | Vehicles — mounted MG first, driveable second |
| E-4.9 | Deployment — **multi-region** game servers, session allocation, drain and reclaim, observability — **the single-host slice moved to M1.5** (T-1.5.07) |

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
| R2 | **Cover-shooter netcode** doesn't feel good in a browser | Critical | M1 answers it for one player against a simulated link · **M1.5 answers the half M1 structurally cannot — two humans, real socket, real latency (§4.2)**. R2 closes at T-1.5.08, not T-1.24 | M1 · M1.5 |
| R3 | **Combat AI** fails to read as competent | High | Dedicated milestone, early grey-box prototyping, generous buffer | M3 |
| R4 | **Six players amplifies level cost** — wider levels, ~1.5× encounter density | High | Two-fireteam mission template (§1.2); reuse kit aggressively | M4 |
| R5 | **Browser performance** on lower-end hardware | Medium | Budget enforced in CI (E-4.2) · desktop-only v1 (ADR-002) | M4 |
| R6 | **Cross-platform simulation drift** — Rapier's default build guarantees only *local* determinism, and JS transcendentals differ by engine | High | Deterministic Rapier build (ADR-005) · table trig in `shared/math` (T-0.14) · parity harness logging divergence trend (T-0.11) · **CI runs a non-V8 engine**, without which the bug is invisible | M0 |
| R7 | **Hosting cost** at scale | Medium | Session-based regional allocation; measure early, model before launch | M4 |
| R8 | **IP exposure** | Low but absolute | Original names, characters, and assets throughout. Historical setting is fine; real unit insignia and branding are not. | Ongoing |
| R9 | **Scope creep** | High | Anything not in §1.4 goes to a backlog file, not into a milestone | Ongoing |
| R10 | **Determinism theater** — a whole-world golden hash that breaks on every tuning change, gets re-baselined reflexively, then catches nothing | Medium | §2.3 scopes parity to the two paths that actually need it; parity tests own their constants in the fixture | M0 |
| R11 | **Estimates are a floor, not a plan** — §4 sums to ~50 wks; comparable solo projects run 3–5× | High | §4.1 scope cut · re-estimate at every milestone gate from *measured velocity*, never from this table | Ongoing |
| R12 | **A publicly reachable host is a public attack surface**, with no accounts, no rate limiting and a cost meter running — arriving ~30 wks earlier than the plan assumed | Medium | Unlisted host, room codes required to join, connection and room caps (T-1.5.05), one small instance, teardown documented in `docs/DEPLOYING.md`; current host: `wss://sandline-host.fly.dev` · real authentication is E-4.6, and nothing before it should pretend otherwise | M1.5 |

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
4. ~~**Where does this repo live?**~~ **Resolved 2026-09-17.** Split out of an
   unrelated repository into `JoshuaLRay/Sandline` with `git subtree split`, so
   the commit history came with it. The forcing function was GitHub Pages:
   one site per repository, so the game and the host repo were competing for
   the same URL.
5. **Session persistence model.** Does a campaign save belong to the host, or
   does every player carry their own soldier's progression across sessions?
   Affects E-4.6 substantially.
6. **What fights back in M2?** Raised 2026-09-18 by the M1 gate amendment in
   §4. M2's exit gate is "a human plays a grey-box firefight", which presumes
   something that shoots back, but every AI epic sits in M3 and M2 has none.
   Either M2's gate means a firefight against dummies, or M2 needs a minimal
   hostile — enough perception and locomotion to take a shot and be shot at —
   pulled forward from E-3.2/E-3.5. Decide at M2's planning gate (§0.5), not
   before: it changes what M2 is for.

   **Partly answered by M1.5**, added later the same day. Once two humans share
   a session the thing that shoots back can be the other person, which tests
   recoil, tracers and hit feedback better than a dummy and costs no AI at all.
   It does not retire the question — a human opponent says nothing about cover
   behaviour or suppression, and M3 still needs somewhere to start — but it
   does mean M2 can open without answering it first.

7. **Does a player ever host?** Raised 2026-09-18 by M1.5. T-1.5.01 produces a
   host process that anyone can run, and the in-page session already is a listen
   server in all but name. So the capability arrives whether or not it is a
   product decision. ADR-011 rejects peer-to-peer *with host migration* for
   production on latency, NAT and trust grounds, and that stands — but a
   player-run dedicated host on a LAN, or a community server, is a different
   proposition it does not explicitly rule on. Affects the E-4.9 cost model
   (R7), the trust model, and whether the client ever needs LAN host discovery.
   Decide before E-4.9. Nothing in M1.5 waits on it: a development host is a
   development host under either answer.

---

## 10. Immediate next actions

**Current milestone: M2. Updated 2026-09-20.** M1 and M1.5 are closed. E-2.1,
E-2.4, and E-2.6 are now built and human-signed off. The three M2 human gates
(T-2.07, T-2.12, T-2.16) have passed on the owner's judgement. CI remains
green, including the non-V8 parity job.

1. **Run T-2.24.** 🧍 E-2.2 is built through T-2.23 on the skinned soldier
   (T-2.22); `docs/playtests/e2-2.md` is the run sheet, prepared and not run.
   It needs a second person on the host: the bots never shoot, so crawl,
   revive and remote believability cannot be judged alone.
2. **Continue E-2.3 — Animation system.** Broken out 2026-09-20 as T-2.25
   through T-2.29 (§7.4). Aim offsets (T-2.25), the fire and reload layers
   (T-2.26), the hit reaction (T-2.27) and foot placement (T-2.28) are all in,
   so **E-2.3's build work is done and T-2.29, the sign-off, is what remains**:
   two people on the host, judging whether the body reads what the other is
   doing, and tuning the layers' numbers with the feel in hand. Each layer is
   procedural on the rig contract; none moves anything authoritative.
3. **Keep tuning data opportunistically.** Weapon and downed values remain
   data-driven; adjust them when a concrete playtest issue appears rather than
   reopening completed gates without a reason.

E-2.5 and E-2.7 remain epics until their turn. M2's exit gate remains the
overall human judgement that third-person combat feels good.
