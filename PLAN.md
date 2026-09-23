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
7. **Keep `TASKS.md` current.** The same commit that appends the CHANGELOG
   line also flips that task's row in `/TASKS.md` from OPEN to DONE (or to
   BLOCKED/🧍, if that's where it lands). A task is not done while the tracker
   still says otherwise.

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
| E-2.8 | Prone stance & voluntary crawl | Authoritative prone height/hit volume, prone crawl speed, fire-from-prone — see [ADR-016](./docs/adr/016-prone-stance.md), which reopens the v1 exclusion in ADR-002 |

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

### 7.3 E-2.4 leaf tasks — broken out 2026-09-20

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

### 7.4 E-2.6 leaf tasks — broken out 2026-09-20

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

### 7.5 E-2.3 leaf tasks — broken out 2026-09-20

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

### 7.6 E-2.5 leaf tasks — broken out 2026-09-21

E-2.3's build work is in (T-2.25 through T-2.28) and its only open item is the
human gate, so the next epic is broken out. **E-2.5 before E-2.7**, for two
reasons. E-2.7 needs audio assets nobody has sourced, which is R1 and §9 Q2,
and buying them to hear a rifle is a decision about the project's largest cost
made for the smallest reason. And E-2.5 no longer needs what it was waiting
for: §7.5 held it back because it wants "a target that shoots" (§9 Q6), and
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
- **Done when:** tests assert the shake falls off with distance and is zero past the radius, that cover cuts it by the same fraction the damage is cut by, that a detonation is not drawn before its tick is being rendered and is drawn exactly once when it is, that several released blasts come out in the order they went off, that a projectile goes into its own list and never the remote players', and that the blast pool never grows and is gone by the end of the scorch. A browser run: the blast reads from across the range.
- **Completed 2026-09-22.** `effects.blast` is a pooled fireball, light, debris and scorch, every part a closed form of its age like the flash and the shells, so 30 and 120 fps draw the same picture at the same moment (asserted by stepping two pools at the two rates to the same instant and comparing the debris positions). The scorch is a disc, on whatever surface is under the blast, and a blast with nothing close enough below it leaves no ring. The camera's jolt is scaled by `blastDamageOn` itself — the same function over the same box list the server scored the damage with — so the shake and the damage cannot disagree: a blast that hurt you rings the camera, one behind a wall is felt through the wall at the cover fraction, one past the radius is not felt at all. Each target takes the T-2.27 reaction away from the blast, with the blast standing in for the shooter and the torso for the zone. `NetClient` releases each blast when the render clock reaches its tick, oldest first. Browser run on the built page, in-page session: hold G and the arc draws from the hand to a ring on the ground; release and the grenade flies it; 2.6 s later the HUD reads `last blast M2 Frag 37 dmg on 1` with `blasts 1/4` live, health 63/100 — the thrower's own blast, on the thrower — and a round scorch with debris over it sits where the ring was.
- **Size:** M

#### T-2.34 — 🧍 E-2.5 sign-off
- **Depends:** T-2.30, T-2.31, T-2.32, T-2.33
- **Files:** `docs/playtests/e2-5.md`
- **Do:** Two people on the host. Each throws grenades at the other and at cover: does the arc read where it is going, does the grenade land where the line said, does a bounce off a crate go where a bounce should, does a blast behind cover feel weaker than one in the open, and is the rocket worth the two rounds it carries. Tune the numbers in `projectiles.json` while the feel is in hand.
- **Done when:** a written verdict, on a run sheet prepared before the session as `e2-2.md` was, naming what it does and does not establish.
- **Size:** S

### 7.7 The soldier's look — broken out 2026-09-21

E-2.3's build work closed at T-2.28 and only its human gate is open, so this
takes the request `docs/HANDOFF-SOLDIER-LOOK.md` was written for and makes it
tasks:

> *"I'd like to update how the player models look. I'd like them to look like
> the player models from PS2 era like Desert Storm."*

**This is not a change of art direction; it is the first delivery of the one
already locked.** `PLAN.md` line 5 says "in the spirit of early-2000s console
squad tactics games" and ADR-013's context names the same era as the reason a
browser build is realistic at all. What has never existed is any of the art
*treatment* that would make it read that way. T-2.22 built a soldier out of
untextured primitives under a PBR material, and it reads as exactly that.

**Original IP, and the reference is a technique, not a game (R8).** Desert
Storm is named here for the era's *rendering constraints and silhouette
language* — low triangle counts, one small hand-painted diffuse, vertex-ish
lighting, chunky gear. No models, textures, characters, names, insignia or
likenesses are copied, and no asset is sourced from it. Rebuilding a technique
is not taking anyone's IP; the standing rule is unchanged and unthreatened.

**PS2, not PS1 — the distinction is most of the work.** The usual "retro 3D"
kit is the wrong console and would read as a bug rather than a style: **no
vertex jitter and no affine texture warping**, both of which are PS1. The
target is a low-poly silhouette, ONE small point-filtered diffuse carrying all
the detail, simple lighting, hard shadow edges and a narrow palette.

**Why the triangle count is not the problem.** At 1,446 triangles the soldier
is already squarely in the era's range. Four other things do the damage: no
texture at all, a PBR material under soft shadows, round primitives, and
realistic rather than stocky proportions. The tasks below take them in that
order, texture first, because that is where the look actually lives.

**Nothing authoritative moves.** The hit capsule (`HUMANOID_HIT_RADIUS` 0.35,
`HUMANOID_HIT_HALF_HEIGHT` 0.55, pinned to the server's `DEFAULT_HITBOX`), the
aim attachment's world place, the trace origin, the bone names and
bind-pose-is-identity are all untouched by every task here. **If a change to
how a soldier looks makes a test about where a bullet goes fail, the change is
wrong — not the test.** The grey box behind `?greybox` stays as the fallback
and diagnostic fixture.

**This is not on M2's critical path** — the exit gate is whether combat
*feels* good, not how it looks — but it runs now because the look affects
every remaining playtest, T-2.24 and T-2.29 included, and those are judged by
eye.

#### T-2.35 — One diffuse atlas, procedurally generated
- **Depends:** —
- **Files:** `packages/client/src/character/soldierTexture.ts`, `soldierPalette.json`, `humanoidSoldier.ts`, `packages/client/tsconfig.json`, tests
- **Do:** A 256² `DataTexture` built from arithmetic — no DOM, no asset, no loader — with `NearestFilter` magnification and a cell per body part. Paint the detail the geometry does not carry: pouches, straps, seams, boot cuffs, a helmet band, a plain face. Keep `weld()`'s UVs and remap each segment into its cell. Palette in data (standing rule 4).
- **Done when:** the soldier renders textured with one draw call and one material; the atlas builds in Node with no DOM; a test asserts the atlas's size, filtering and known texels; triangle count unchanged; `pnpm verify` green.
- **Size:** M
- **Completed 2026-09-21.** `soldierTexture.ts` paints a 256² atlas into a `Uint8Array` as a 4×4 grid of 64px cells — face, helmet, torso front and back, vest, belt, sleeve, glove, trouser, boot, neck, rifle, pack and two plain cells — and wraps it in a `DataTexture`, point-magnified, mipmapped for minification, sRGB. A `DataTexture` rather than a `CanvasTexture` because client tests run under `environment: 'node'` where a canvas throws and every soldier test builds a soldier; rather than an image because there is no loader, no `public/` and no asset pipeline in this client until E-4.1, and standing rule 3 would want an ADR and a licence for one. `remapGeometryUv` moves each primitive's own UVs into its cell and takes an ARRAY to give a box a cell per face, which is how one torso box carries a placket and chest pockets on the front and a plain yoke on the back. `weld()` now carries `uv` across and no longer synthesises the flat per-segment vertex colour, which is gone: the atlas says everything it said and the things it could not. **Two measured findings are pinned by test.** Three's spheres and capsules emit `u` outside [0, 1] — -0.0625 to 1.0625 on an eight-segment capsule, a seam nudged half a segment past each edge — so `cellUv` clamps, or that sliver reads the next cell and paints a stripe of boot sole up a sleeve. And the remap insets by half a texel at every edge, because a primitive emits u = 1 on its last column and under nearest filtering that lands on the first texel of the *next* cell. Geometry, bone names, bind pose, hit capsule and aim attachment all untouched; the rifle takes the same atlas, so it stays the second draw rather than becoming a third material.

#### T-2.36 — The silhouette
- **Depends:** T-2.35
- **Files:** `humanoidSoldier.ts`, tests
- **Do:** Chunkier, flatter, era-correct proportions inside the same 1.8 m capsule: bigger boots, gloves, a helmet with a brim, a collar, webbing and pouches as geometry slabs, squarer limbs (fewer radial segments, flat where the era was flat). Keep the bone table's joint positions wherever possible; where they move, move the pinned assertions with them in the same commit.
- **Done when:** the root capsule, the aim attachment's world place, the bone names and the bind pose are all unchanged; triangles stay under the guard and inside ADR-013; every E-2.2/E-2.3 layer test still passes; `pnpm verify` green.
- **Size:** M
- **Completed 2026-09-21.** The largest single change is that the helmet has a BRIM — one disc at the dome's rim, and the strongest era cue the model has; without it a helmet reads as a swimming cap. Then oversized boots with an upper on the shin that wears them so the trouser does not stop in mid-air above a block, bigger gloves, thicker limbs on six radial segments rather than eight, shoulder slabs instead of balls, and a collar and five pouches as geometry, because gear that breaks the outline is most of what tells a 2002 soldier from a mannequin. **Triangles went DOWN, 1,446 to 980:** faceting the limbs bought more than the gear slabs cost, which is worth saying plainly rather than padding the model back up to a number — the era's range was 1–3k and the silhouette was what was wrong, not the budget. Every joint position in the bone table is unchanged, which is what makes this an art change rather than a rig change: the arms' IK constants, the legs' lengths derived by `footPlacement.ts`, and every pinned assertion hold exactly, and all of E-2.2's and E-2.3's layer tests pass untouched. New guard, and the reason the pack moved in 2 cm: every skin vertex must stay within `HUMANOID_HIT_RADIUS` of the root axis and fill at least 80% of it — a shoulder or pack outside the capsule is a netcode bug wearing art's clothes, since you would watch rounds pass through visible kit, and a thin soldier rattling inside a fat hitbox is the same fault the other way up.

#### T-2.37 — The era's shading
- **Depends:** T-2.35
- **Files:** `main.ts`, `humanoidSoldier.ts`, `humanoidPlaceholder.ts`, tests
- **Do:** Drop PBR for the characters (`MeshLambertMaterial`, or Standard pinned to roughness 1 with no environment contribution) and harden the shadow filter. Keep ADR-013's one shadow-mapped sun and the dust haze. **No vertex jitter and no affine texture warping.**
- **Done when:** a human says it reads as the era; frame time no worse than before; the grey box still renders; `pnpm verify` green.
- **Size:** S–M
- **Completed 2026-09-21**, except the human half of its gate, which is T-2.39's. The characters drop PBR for `MeshLambertMaterial` and the shadow filter hardens from `PCFSoftShadowMap` to `PCFShadowMap`: a roughness response and a soft penumbra under a soldier are the two things that read as modern however well the character is textured. Lambert is diffuse and nothing else, which is what hardware lighting in 2002 was, and it is cheaper besides. The grey box takes the same material so the fixture is lit like the thing it stands in for. **Smooth normals on purpose:** `flatShading` is the reflex here and it is the wrong console — the PS2 interpolated per-vertex lighting across a triangle, so its curved surfaces read smooth and only the SILHOUETTE gave the polygon count away, which is exactly what T-2.36's six-sided limbs do; faceted shading is a 2015 indie look. No vertex jitter and no affine warping either. ADR-013's one sun and the dust haze are untouched. **The low-resolution render target is deliberately NOT done and is section 6 of T-2.39's run sheet:** it is the strongest remaining era cue and it also costs crosshair, tracer and hit-marker legibility that T-2.24 and T-2.29, both still open, are judged on. Which way that trade goes is an owner's call.

#### T-2.38 — Squad colours from the atlas
- **Depends:** T-2.35
- **Files:** `soldierTexture.ts`, `humanoidSoldier.ts`, palette data, tests
- **Do:** Per-slot variation — local, squadmate, bot — as palette swaps of the same atlas rather than new materials or new geometry, so six soldiers stay six draws of the same one. Keep the local/remote distinction the harness already relies on.
- **Done when:** six soldiers on screen with distinguishable kit; no extra draw call per variant; `pnpm verify` green.
- **Size:** S
- **Completed 2026-09-21.** The palette data becomes a `base` plus per-name overrides, so a squad of six is one set of colours wearing six markings rather than six unrelated schemes — which is what a squad looks like, and what keeps a slot colour to one line of data. `paletteFor({local, human, slot})` reads the palette off the roster; `setSoldierPalette(root, name)` repaints a LIVE soldier by swapping the atlas and nothing else — same geometry, skeleton, material and draw call. That matters more than it looks: ADR-001's bot/human swap happens on a live entity rather than by rebuilding the session, so a slot changing hands has to be a texture swap, and `main.ts` re-asks every frame rather than fixing the colour at creation (the call skips when nothing changed). **The marking moved twice and both reasons are worth keeping.** It is the HELMET BAND and not a patch, because a patch does not survive forty metres and a band is visible from every angle, range and pose. And the band sits a third of the way UP the dome rather than at the rim where a band belongs, because T-2.36's brim occludes the rim exactly — the first version was painted correctly and invisible on the model. The shoulders carry it too, since the helmet mark and the vest patch both face front and a squad seen from anywhere but head-on shows neither. `remote` stays as the fallback before the roster arrives; the grey box answers false rather than throwing.

#### T-2.39 — 🧍 Look sign-off
- **Depends:** T-2.35, T-2.36, T-2.37, T-2.38
- **Files:** `docs/playtests/soldier-look.md`
- **Do:** Two people on the host, at the ranges the game is actually played at — across the range, in cover, downed, at a sprint. Judge whether it reads as 2002 rather than as untextured geometry, whether soldiers are distinguishable at 40 m, and whether the silhouette still reads through the E-2.3 layers.
- **Done when:** a written verdict on a run sheet prepared before the session, naming what it does and does not establish.
- **Size:** S
- **Run sheet prepared 2026-09-21, not run.** `docs/playtests/soldier-look.md`, written as `e2-2.md` was and saying so at the top. Section 6 carries the one decision T-2.37 deliberately left open — whether to render at a fixed low resolution and upscale with point filtering — because it trades legibility the two open feel-gates are judged on, and that is the owner's call to make with the thing in front of them.

### 7.8 E-2.8 leaf tasks — broken out 2026-09-22

[ADR-016](./docs/adr/016-prone-stance.md) reopens ADR-002's prone exclusion:
the owner asked for a voluntary prone stance now that crouch (T-2.20) has
already built authoritative stance height/hit-volume and E-2.6 already
proved a crawl gait end to end for the downed state. Prone is **not** the
downed crawl B-05 removed — that removal stands, and is not reopened here.
Prone is a stance a standing, alive soldier chooses to enter, keeps their
weapon in, and chooses to leave.

**Two rules for this epic**, the same shape T-2.20 and T-2.13 set: vitality
and stance are the SERVER'S (nothing predicts a stance transition the
server didn't authorize, only replays one from replicated/input state, same
as crouch), and prone reuses the existing hit-capsule-by-stance and
pose-driver contracts rather than adding a second one.

#### T-2.40 — Prone state, authoritative height/hit volume, prone crawl speed
- **Depends:** T-2.20, T-2.13
- **Files:** `packages/shared/src/sim/CharacterController.ts`, movement/data config, `ecs/components.ts`, `net/schema.ts`, `net/protocol.ts`, `Session.ts`, `NetClient.ts`, tests
- **Do:** A `prone` stance alongside standing/crouch, entered/exited by a bound key and authoritative on the server exactly as crouch is: its own controller height, ceiling clearance and hit volume, and its own crawl speed in data (distinct name and value from the removed `crawlSpeed`, which stays gone — this is not its resurrection). Entry is refused while downed, dead, mid-vault, or sprinting; sprint/jump inputs are ignored while prone, same as crouch. Client prediction uses the identical state and constants the server does.
- **Done when:** shared tests assert prone height/clearance/hit-volume distinct from both standing and crouch and from the downed hitbox; standing↔prone and crouch↔prone transitions; ceiling rejection; blocked entry while downed/dead/vaulting/sprinting; prediction parity between server and client; lag-comp tests assert the prone hit volume differs from both standing and crouch. `pnpm verify` green.
- **Size:** M
- **Completed 2026-09-22.** Stance became a three-level ladder in `stepCharacter` — standing (0), crouched (1), prone (2, lowest) — instead of a second parallel boolean next to crouch: dropping a level is instant, rising one is checked one level at a time against the target height after horizontal movement resolves, which is the same ratchet crouch already used, generalized rather than duplicated. Prone gets its own `MoveConfig.proneHeight` (0.8 m) and `proneSpeed` (1.1 m/s), and its own server hit-capsule (`DEFAULT_HITBOX.proneHalfHeight`/`proneCenterOffsetY`, factored into a shared `capsuleFor` helper `lagComp.ts` and `Session.ts`'s `bodyAlong` both call, rather than duplicating the crouch/prone ternary a third time) — 0.8 m total height, well under crouch's 1.2 m and standing's 1.8 m. Wire: the `Crouch` component (id 5) gained a second `prone` bit (protocol v14), and `INPUT_BUTTONS` gained `prone` (`0b100000`). One deviation from the Do text, decided during implementation rather than asked back: entry is **not** specially refused while sprinting — like crouch, holding sprint and pressing prone just goes prone (sprint is ignored via the same speed-selection precedence crouch already uses), rather than adding a second, redundant refusal. "Blocked while dead" is Session.ts's job, not `stepCharacter`'s: a dead slot's movement is skipped entirely upstream (as it already was for every other stance), so there is nothing for the controller itself to refuse. Jump is newly blocked while prone (crouch itself does not block jump — that was pre-existing and left alone). Prediction parity is inherited for free: `stepCharacter` is the one shared pure function both sides already run, so there is no second prone-specific path to diverge, and `characterParity.test.ts`'s fixture and the full suite stay at zero measured divergence with the new fields present.

#### T-2.41 — Prone presentation
- **Depends:** T-2.40, T-2.06
- **Files:** `packages/client/src/character/locomotionState.ts`, `locomotionPose.ts`, `humanoidPlaceholder.ts`/`humanoidSoldier.ts`, `cameraSolve.ts`, tests
- **Do:** A `prone` locomotion classifier state (distinct from `crouch` and from the downed pose) driving a low, front-down pose on the existing pose-driver contract — reuse the rig/pose plumbing T-2.06/T-2.20/T-2.14 already built, not a new one. The camera eases to a prone eye height on the same curve crouch and downed already use. The weapon stays in hand and aimable; this is not the downed pose, which has none.
- **Done when:** tests assert the pose is applied from replicated stance and restored exactly on standing/crouch, that the shootable root's geometry is untouched, and that prone is visually and structurally distinct from the downed lie-down pose in the same test suite that guards that distinction. A headless run drops the local player prone and screenshots the view.
- **Size:** S

#### T-2.42 — Fire from prone
- **Depends:** T-2.40, T-2.41
- **Files:** weapon fire path (client + server), aim/recoil config, tests
- **Do:** Firing is permitted while prone (unlike while downed, which stays refused per T-2.13). Recoil/spread may be tuned tighter prone than standing/crouch in data, but no new mechanism — reuse the existing fire/aim pipeline with prone as another stance input to it.
- **Done when:** tests assert Fire succeeds while prone end to end over the wire, and that stance-conditioned aim/recoil tuning (if any) reads from data, not a hardcoded branch. `pnpm verify` green.
- **Size:** S
- **Completed 2026-09-22.** Nothing refused a prone Fire; what was missing was that the shot still left from STANDING eye height, 0.75 m above the prone hit volume, so prone behind cover shot over it. `eyePosition` gained the body's prone stance as an input (the muzzle stance/view still is not one) and the muzzle rig a `proneEyeHeight`; the server takes both stance and origin from the shooter's rewound sample so the two never disagree. Spread got `proneSpreadScale` per weapon row as a stance input beside `ads` — same pipeline, no new mechanism. Recoil left alone (the spec allowed tuning, not required it). Crouch still traces from standing eye height and so do throws in every stance: logged as B-09 rather than widened into this task.

#### T-2.43 — 🧍 E-2.8 sign-off
- **Depends:** T-2.40, T-2.41, T-2.42
- **Files:** `docs/playtests/e2-8.md`
- **Do:** A human goes prone, crawls into and out of cover, fires from prone, and stands back up, then does the same as the other player watches remotely. Judge whether prone reads as clearly different from both crouch and the downed pose, whether the crawl speed feels earned rather than crippling, and whether firing prone is usable rather than a curiosity.
- **Done when:** a written verdict, on a run sheet prepared before the session as `e2-6.md` was.
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

**Broken out 2026-09-22 — see §7.9** for the leaf tasks (T-3.01..T-3.37).

### 7.9 M3 leaf tasks — broken out 2026-09-22

Broken out at the owner's request **ahead of M2's exit gate**, which §0.5
would otherwise have waited for. That is deliberate and it is bounded: M3's
tasks depend on M2's *build* — the controller, the fire path, the downed
state, grenades, the rig — all of which is in, and on none of M2's four open
🧍 verdicts. The tracker still hands out M2's remaining work first (T-2.42,
then the gates), because `/next-task` scans milestones in order. M3 is broken
out now because it is R3, the highest-uncertainty milestone after M1, and its
first tasks — the navmesh spike and the behaviour tree runtime — need nothing
M2 has left to decide. If a pending M2 gate changes the controller or the
fire path, the M3 tasks downstream of it are re-read before they start, not
rewritten now.

**What already exists.** More of the substrate than the epic table suggests,
and none of the behaviour:

- **Six slots with bot backfill** (T-1.13, ADR-001). A bot slot today is an
  idle input on a live entity — `Session` steps it through `stepCharacter`
  like anyone else, records it into the lag-compensation history, and swaps it
  for a human in place on join. Backfill is already structural; what is
  missing is a brain.
- **One movement model and one world.** `stepCharacter` over `DEFAULT_WORLD`'s
  axis-aligned boxes (T-1.12), with crouch, prone and the vault rule (T-2.20,
  T-2.40, T-2.21). Soldiers do not collide with *each other* — the controller
  collides with boxes only — so local avoidance is the only thing that will
  keep a squad from walking through itself.
- **The whole combat path.** `rayWorld`, hitscan with lag compensation, damage
  zones, `applyDamage` with downed/bleed-out/revive (T-1.17..T-1.19, T-2.13,
  T-2.15), grenades and rockets on a pure-arithmetic stepper with blast
  occlusion by the same box list (T-2.30, T-2.31). A blast's three-probe
  visibility test (shin, chest, head) is already the shape a line-of-sight
  check wants.
- **Entities that come and go.** Projectiles (T-2.31) were the first spawns
  and despawns on the wire, with their own netId range above the range
  targets'. Enemies are the second.
- **The in-page session runs the server in the browser** (`LocalServer`
  constructs a real `Session`). Anything the AI needs — including Recast's
  WASM — must therefore initialise in Chromium, Firefox and WebKit as well as
  in Node, not only on the host.
- **Nothing else.** No navmesh, no `recast-navigation` dependency, no
  `shared/src/ai/`, no `server/src/ai/`, no enemy entity, no interest
  management (every client is sent every entity), no second world.

**Five rules for every task here.**

1. **The AI plays by the player's rules.** A brain produces a `MoveInput` and
   a trigger pull; `stepCharacter` moves it, the fire path shoots for it,
   `applyDamage` hurts it. No second movement model, no AI-only hitscan, no
   damage shortcut. This is what makes a bot's movement collide, vault and
   crouch exactly as a person's does, what makes an enemy shootable through
   the same lag-compensated history, and what makes a human taking over a
   bot's slot (ADR-001) a change of *input source* rather than of entity.
2. **Server-only, replicated, never predicted** (§2.3). AI may diverge across
   engines freely; it still takes its randomness from the seeded PRNG
   (seeded from tick + netId) and reads no clock, so a headless run is
   reproducible and a failing seed can be replayed.
3. **Behaviour at 10 Hz, locomotion at 30 Hz** (ADR-012). A brain decides
   intent on its tenth-of-a-second; path following turns the latest intent
   into an input every tick.
4. **Data over code** (§0.3 rule 4). Archetypes, perception ranges, accuracy,
   behaviour trees, encounters and director tuning are JSON validated at
   import the way `weapons.json` is. A number that decides whether an AI reads
   as competent is a number someone will tune in a playtest.
5. **Competence is measured before it is judged.** Every behaviour task ships
   a seeded headless scenario that reports the number it is about — time to
   reach cover, fraction of time exposed, suppression dealt — and asserts a
   floor. The 🧍 gates judge whether those numbers *read* as competent; they
   are never the first place anyone finds out the behaviour does not happen.

**Scope decisions made in this breakout** (raise at the next gate if wrong):

- **Two archetypes are built, not five.** ADR-015 cuts the slice to rifleman
  and MG. E-3.6's schema is written to hold RPG, sniper and officer, but they
  are not authored or tuned in M3 — that is content, and §4.1 cut variety,
  not structure.
- **Any player may order any bot** (ADR-001). §1.3 gives the Team Leader
  "order authority", but classes do not exist until E-4.7; until then
  authority is not class-gated, and target marking is open to everyone.
- **The mission is minimal.** M3's exit gate needs "the same grey-box
  mission" to exist, so E-3.9 gets one box-world map, one encounter file and
  one objective type. That is a fixture for the gate, not E-4.4's mission
  scripting, and it says so in its files.
- **An AI CPU budget is proposed, not locked:** brains, perception, path
  following and avoidance together at **≤ 25 % of the 33.3 ms tick** with
  forty enemies and five friendly bots, mirroring the share ADR-005's
  addendum gave physics. T-3.35 measures it; if the number is wrong, change
  it there with the measurement beside it.

**Not in this milestone.** AI going prone (enemies and bots crouch; prone is
a player's choice until a gate asks for more), vehicles and mounted weapons
(E-4.8), RPG/sniper/officer archetypes, class-gated orders, voice or text
comms, and any mission scripting beyond what T-3.34 names.

#### T-3.01 — ⚠️ Recast in both runtimes
- **Depends:** —
- **Files:** `packages/server/src/ai/nav/NavMesh.ts`, `packages/tools/src/nav/bake.ts`, `packages/server/package.json`, `packages/tools/package.json`, `docs/adr/006-recast-navigation.md` (addendum), tests, browser test config
- **Do:** Add `recast-navigation` (ADR-006; pin the exact version, as ADR-005's addendum pinned Rapier's). Bake a navmesh in Node from a hand-built triangle soup of a floor and a few boxes, export it to bytes, and load those bytes back through a `NavMesh` wrapper exposing only what M3 needs: nearest point on mesh, path (corridor + straight path), and a mesh raycast. Initialise it in Node **and** in the browser runtimes the parity job already runs, because `LocalServer` runs the session in the page. Measure WASM init time, bake time and query cost.
- **Done when:** tests load the same exported bytes in Node and in Chromium plus one non-V8 engine and get a path between the same two points on each, with the path's length divergence logged and bounded (§2.3 — AI is not parity-critical, so this is a sanity bound, not a gate); init is awaited before a session's first tick in both runtimes; the ADR-006 addendum records the version, init cost, bake time and µs per path query. If Recast cannot run in one of the runtimes, the write-up says so and what the fallback would cost — that is an acceptable outcome of a spike.
- **Size:** M
- **Completed 2026-09-22.** The spike succeeded: Recast runs in all four runtimes and there is no fallback to cost. `@recast-navigation/core` 0.43.1 (server runtime) and `@recast-navigation/generators` 0.43.1 (tools only, so the bake never ships in the server), pinned exact; the umbrella package was not taken because it would have made the generators a server runtime dependency. The default WASM entry inlines the binary as base64, so the same import works in Node and the page with no extra file or bundler plugin (+726 kB / 220 kB gzip page chunk). `NavMesh` (`server/src/ai/nav/NavMesh.ts`) exposes only `nearestPoint`, `path` (corridor + string-pulled points) and `raycast`, plus an idempotent `initNav()`. `pnpm gen:nav-spike` bakes a floor, a 2.4 m wall with a gap and two crates in Node and commits the bytes with the Node path length (`spikeMesh.ts`); `NavMesh.test.ts` runs under the default config and under a new `nav-browsers` project in `vitest.browser.config.ts` (Chromium, Firefox, WebKit — CI's browser job now installs Chromium too). All four return the same 47.0185 m path, **divergence 0 m** everywhere, asserted under 1 cm. Init before the first tick: `SessionHost.start` awaits `initNav()` before it listens, and `LocalServer.create` awaits it in the page, whose constructor now throws if it has not resolved; `main.ts` starts the init at load. Measured (ADR-006 addendum): init 45–106 ms (WebKit 224), bake 86 ms, warm path 28.6 µs, nearest point 2.1 µs, raycast 3.2 µs. A tools-side test re-bakes and requires the committed bytes exactly, so a geometry edit without re-running the generator fails; that is the spike's fixture only — T-3.03's per-world staleness hash is still its own work.

#### T-3.02 — Named worlds
- **Depends:** —
- **Files:** `packages/shared/src/sim/world.ts`, `packages/shared/src/data/worlds/*.json` (today's `world.json` becomes `worlds/range.json`), `net/protocol.ts`, `Session.ts`, `server/src/config.ts`, `client/src/net/*`, `client/src/main.ts`, tests
- **Do:** Today every consumer imports one `DEFAULT_WORLD`. Make the world a value a session is constructed with, chosen by id (`WORLD=range pnpm host`, defaulting to `range`), sent in `JoinAck` (protocol bump), and built on the client from the same data by the same function. `range` is the only world when this lands; T-3.31 adds the second. Generated pieces (posts, rails, reference figure) belong to the range world's definition, not to every world.
- **Done when:** tests assert a session built with a named world collides, shoots and throws against that world's boxes and no other; that `JoinAck` round-trips the id and a client given an unknown id refuses the join with a typed reason rather than rendering the wrong scenery; that the range world is box-for-box what `DEFAULT_WORLD` was (the existing world tests pass unchanged against it). `pnpm verify` green.
- **Size:** M
- **Completed 2026-09-22.** `world.json` moved to `data/worlds/range.json`, which now carries its own `id` and a `generate` list (`posts`, `rails`, `figure`): the generated pieces are the range's because its file asks for them, and a world that does not ask gets none. `loadWorld(raw)` validates a world file and builds its boxes in a fixed order (generated pieces, then cover); `getWorld`/`requireWorld`/`WORLD_IDS`/`DEFAULT_WORLD_ID` look one up. World files are imported statically rather than read from disk, because the same module builds the world in the page. `DEFAULT_WORLD` stays as the range's boxes — the pure functions' fallback, and the object the existing world tests run against unchanged — but no session path relies on it: `Session` takes a world id or a built `World` (tests build their own), and every collision, shot, throw, launch and blast passes `this.world.boxes`. `WORLD=range pnpm host` (validated in `config.ts`; unknown id is a startup error) reaches each room through `Registry`, and `/healthz` reports it. `JoinAck` gained `world` (protocol v16); `DISCONNECT_CODES` gained `'unknown world'` (appended). `NetClient` builds the world with `getWorld` on JoinAck, predicts against it, and refuses an unknown id — typed Disconnect back to the host, never counted as joined, the lobby shows why. `Predictor` takes the world; the bot predicts against the host's world too. The page draws the range at load and redraws when a join names a different world (`buildScenery`/`useWorld`); foot placement reads the world through a getter. One call not in the Files list: `bot/src/BotClient.ts`, because a bot predicting against the wrong world would report divergence that is a map mismatch, not netcode.

#### T-3.03 — The box world, baked and committed
- **Depends:** T-3.01, T-3.02
- **Files:** `packages/tools/src/nav/bake.ts`, `packages/tools/src/gen-nav.ts`, `packages/server/src/ai/nav/baked/*`, root `package.json` (`gen:nav`), tests
- **Do:** Triangulate every box of a named world (top faces walkable, sides as walls) and bake it with agent parameters derived from `MoveConfig` and the hitbox — radius from the capsule, height from standing height, climb from the step height — not typed in twice. Commit the bake per world, as `gen:trig` commits the trig table. The bake records a hash of the world's boxes and the agent parameters; a test recomputes it and fails if the committed bake is stale. This is ADR-006's "the level pipeline and the navmesh bake must be wired together or they will silently drift", enforced.
- **Done when:** tests assert every spawn point and range target is on the mesh; a path exists from spawn to the far end of the range and to both sides of the east/west walls; sampling every returned path against `rayWorld` at knee height finds no segment that passes through a box; a soldier-sized gap narrower than the capsule is not walkable; and editing a box in the world data fails the staleness test until `pnpm gen:nav` is re-run.
- **Size:** M
- **Completed 2026-09-22.** `bake.ts` gained `worldSoup` (a world's floor plus every box as a closed cuboid — tops walkable, sides walls), `navAgentFrom(MoveConfig, Hitbox)` (radius = the larger of the controller footprint and the hit capsule, height = standing height, climb = step height; `DEFAULT_NAV_AGENT` is today's defaults), a 0.1 × 0.05 m voxel grid (so the 0.35 m radius erodes as 0.4 m — conservative), `navBakeHash` (sha256 of the world id, floor and every box, the agent and the Recast config) and `bakeWorld`. `pnpm gen:nav` bakes every `WORLD_IDS` entry into `server/src/ai/nav/baked/<id>.ts` (base64 + hash + agent) and a generated `index.ts`; the range is 169 kB in 3.7 s, and a re-run is byte-identical. `bakedNav.ts` loads a world's bake, kept out of `NavMesh.ts` so the page does not bundle it until something paths. One addition outside the Files list: the ground is not a box, so a world now names its walkable floor — `floor.halfExtent` in the world file, else the boxes' extent plus 5 m; the range sets 100 m, the square the client draws, because its targets run out to z = 95, past every box. Tests (`tools/src/nav/nav.test.ts`, over the committed bytes): every world's hash matches the live data; the agent is derived, not restated; moving a box, raising the step or widening the capsule changes the hash; every spawn and range target is on the mesh; paths from spawn reach the 95 m target and both sides of both long walls, and none crosses a box at knee height by `rayWorld` (whose check is itself shown to catch a through-wall segment); a 0.6 m gap in a barrier is routed round, a 1.2 m one walked through. Checked by hand: editing `crate-c` in `range.json` fails the freshness test with "run pnpm gen:nav", and re-running it turns the suite green. The generated file is an array joined at load, because a 2,300-term `+` chain overflowed the linter's parser.

#### T-3.04 — Vault links
- **Depends:** T-3.03
- **Files:** `packages/tools/src/nav/bake.ts`, `packages/server/src/ai/nav/NavMesh.ts`, tests
- **Do:** Generate an off-mesh link across every box the controller's vault rule would vault (T-2.21 — reuse its height/depth predicate, do not restate it), in both directions, flagged as a vault so path following knows to walk into it with forward intent. Nothing else becomes a link in M3.
- **Done when:** tests assert a path across the low wall uses its link and is shorter than going round; a box above vault height gets no link; every link's two ends are on the mesh; the staleness hash covers the vault parameters, so retuning the vault forces a re-bake.
- **Size:** S
- **Completed 2026-09-22.** Links are found by asking the controller, not by restating its rule: `vaultLinks(world, agent)` stands a soldier one radius plus a voxel off each face of every box, at points along the face no more than 2 m apart, facing in, and calls T-2.21's `tryStartVault`; each yes becomes a one-way link from there to where the vault lands. Each side is asked separately, so "both directions" is two links wherever both sides vault. The controller will vault onto surfaces the mesh does not reach (the 0.3 m top of the low wall walked lengthwise, a post top, a crate top at the landing point), so `bakeWorld` bakes once without links and keeps only links whose two ends are on that mesh (within a voxel across, a step vertically), then bakes with them: 44 candidates on the range, 6 kept, all on the low wall, three each way (the fourth each way lands on a distance post behind the wall). Links are area 1, flags walk|vault; `NavPath.vaults` names the legs that are vaults (from Detour's off-mesh straight-path flag plus the polygon's vault flag), and `NavMesh.links()` lists what is baked — reading the polygon flags, since a connection's own `flags()` are only its direction bits. `NavAgent` carries `vaultMaxHeight`/`vaultDistance`/`vaultProbe` and the hash covers them plus the link spacing, approach margin and on-mesh tolerance. The bake now takes ~6.5 s (two passes). T-3.03's knee-height test now skips vault legs and asserts each crosses only the low wall. Tests (`vault.test.ts`): low wall crossed by its link both ways, 3.02 m against 6.16 m on the same world baked without links; every committed link is a vault flag with both ends on the committed mesh and is a vault `tryStartVault` would start there; the 2.4 m walls get none; a wall at vault height is linked and one 5 cm over is not, a step-high box is not, a 1 m wall is linked both ways; retuning each vault parameter changes the hash.

#### T-3.05 — Path following as input
- **Depends:** T-3.04
- **Files:** `packages/server/src/ai/locomotion/followPath.ts`, `packages/server/src/ai/nav/NavMesh.ts`, tests
- **Do:** A pure function from (corridor, current `MoveState`, intent) to a `MoveInput`: yaw toward the next corner, move axes, walk/sprint/crouch from the intent, forward intent into a vault link. It is stepped at 30 Hz and the result goes through `stepCharacter` like a human's input (rule 1). Arrival radius, corner smoothing and repath on a stuck detector (no progress along the corridor for N ticks) are data.
- **Done when:** a headless session test drives a bot slot from spawn to a goal 60 m away and it arrives inside the arrival radius within a bounded number of ticks; it crosses the low wall by vaulting; a bot pushed off its corridor (teleported sideways) repaths and still arrives; a goal off the mesh resolves to the nearest point on it; the bot's server position and a replay of its inputs through `stepCharacter` agree exactly (they are the same function).
- **Size:** M
- **Completed 2026-09-22.** `followPath` (`server/src/ai/locomotion/followPath.ts`) is pure: (the path and the follower's place along it, the `MoveState`, the intent) to a `MoveInput` and the follower's next state, threaded tick to tick the way the vault's state rides in `MoveState`. `PathFollower` wraps it with the navmesh and calls Detour only to plan — on a new goal (moved more than `repathGoalMoveM`) and on a stuck report, never mid-vault. Per tick: yaw toward the next corner, rounded once to integer wire units (`Math.atan2` is allowed server-side; none of this is predicted); stick full forward, scaled on the last leg to land on the point, because the controller has no acceleration; sprint or crouch from the intent's pace; on to the next corner inside `cornerRadiusM` or once past it along its leg. A vault leg faces along its link, stands, and presses jump only when a trial `stepCharacter` with jump held starts a vault: `tryStartVault` alone says yes to a crouched or firing soldier, whom the controller then sends into an ordinary hop. The leg ends on the tick the vault lands, not by distance to the link's end, because a vault lands 1.5 m on from wherever it began. Stuck is the distance left along the path not falling by `progressEpsilonM` for `stuckTicks` ticks. Tuning is `follow.json` beside it, validated by hand as `weapons.json` is (unknown keys refused): one file outside the Files list, plus `src/**/*.json` in the server's tsconfig so it compiles. `NavMesh.nearestPoint` now takes a query box, and the new `resolvePoint` widens it ×4 up to a cap and accepts a hit only when it is no further off than the box that found it: the default box answers with *a* near point — 1.16 m from crate-c's centre when the nearest is 1.00 m, and nothing at all past the floor's edge. `path(from, to, searchM)` snaps its ends with it when given a search and is unchanged when not, so the bake's tests ask what they always asked. Tests (`followPath.test.ts`): over a one-wall fixture with no navmesh, a path is walked through `stepCharacter` at walk and sprint with one vault and no hop, crouch-walked with crouch released a tick before the jump, left on landing when the vault began 0.8 m off the link, arrived on the point with a 2 cm radius at sprint, and reported stuck `stuckTicks` ticks after square contact with a wall. On the range through a `Session`: slot 0 → (−33.75, 0, 45.96), 60 m away and a 61.07 m path, arrives in 441 ticks against a bound of 497 (ideal 436), vaults the low wall once and never hops, and equals a replay of its inputs through `stepCharacter` tick for tick; teleported at tick 150 to square behind west-wall-a it repaths once and arrives at tick 306, and with repathing disabled stays pinned there — the push is chosen so, because most teleports on the range walk off a wall end with no repath at all; a goal in crate-c resolves 1.000 m away and is walked to; a goal 50 m past the floor resolves to its edge. The follower costs 6.9 µs a step. `NavMesh.test.ts` covers `resolvePoint` on the spike in Node and the three browsers (Chromium run locally; Firefox and WebKit are CI's). Noticed, not changed: a box taller than the agent and wider than two radii bakes hollow — the spike's 2 m wall has walkable floor inside it, an island nothing reaches (a path to it ends at the nearest reachable ground). The range has none, its tall boxes being 0.3 m thin, but T-3.31's second world should check.

#### T-3.06 — Local avoidance
- **Depends:** T-3.05
- **Files:** `packages/server/src/ai/locomotion/avoidance.ts`, tests
- **Do:** Detour's crowd for avoidance velocities only: agent positions are written into the crowd from each `MoveState` every tick and the crowd's desired velocity is turned into the move axes — the crowd never moves an agent itself, `stepCharacter` does (rule 1). Humans are obstacles in the crowd, not agents.
- **Done when:** six bots sent through the west doorway from opposite sides all get through within a bounded time with no deadlock; no two soldiers' capsules overlap by more than a logged epsilon for more than N consecutive ticks; a bot routes around a standing human rather than through them; crowd cost per tick with 45 agents is logged.
- **Size:** M
- **Completed 2026-09-23.** `Avoidance` (`server/src/ai/locomotion/avoidance.ts`) owns one Detour crowd per navmesh. Each tick every soldier is teleported into it at its `MoveState` with the velocity it actually walked; a bot requests the velocity its path-following input would walk at (`requestMoveVelocity` — the crowd plans nothing, T-3.05 still routes and vaults); after `update` the velocity the crowd settled on is turned back into move axes against the bot's own facing, and `stepCharacter` moves it. "Settled on" is the crowd's displacement of its own copy per second rather than the bare obstacle-adjusted velocity, because the latter has no answer for an overlap — Detour's push apart is what gets two soldiers out of each other — and that copy is overwritten next tick, so the crowd still moves nobody. Humans are entries with no request and no avoidance flags, seen through their walked velocity. A bot mid-vault or on a vault leg (`PathFollower.onVault`, the one line outside the Files list besides `NavMesh.crowd()`) passes its input through unsteered. **One addition the spec did not name:** Detour has no right of way, and in the 1.2 m west doorway plain avoidance deadlocks — 3 of 6 bots never arrive; with the rule below disabled 4 of 6 are still short after 299 ticks. A bot held under `blockedFraction` (0.5) of its asked speed for `patienceTicks` (30) walks its own input for `assertTicks` (30) and on until nobody is inside its capsule, while the others still steer round it. The cost is that in a one-wide gap the soldier it meets head-on is walked through for about a capsule of travel; N is therefore a distance budget (15 walk ticks, 2.1 m) expressed in ticks at the pace. Tuning is `avoidance.json`, hand-validated like `follow.json`. Tests (`avoidance.test.ts`, bot slots of a real `Session` on the range): three bots each side of the west doorway swap places at walk, sprint and crouch, all arriving well inside 4× the longest solo trip (last at 119/87/205 ticks against 166/103/367), overlap past 5 cm at most 10/7/22 consecutive ticks against N 15/10/34, and every bot equals a replay of its inputs through `stepCharacter`; a bot walking a straight 20 m line through a standing human passes 0.84 m from them with no assertion (0.06 m, dead centre, without avoidance); 45 agents in two ranks crossing head-on on open ground all arrive with no overlap and no assertion, at ~0.4 ms mean and ~1.2 ms worst per crowd tick (≈1.2 % of the tick; ADR-006 addendum). Not wired into `Session` — T-3.08 ticks locomotion.

#### T-3.07 — Behaviour tree runtime
- **Depends:** —
- **Files:** `packages/shared/src/ai/bt.ts`, `packages/shared/src/ai/blackboard.ts`, `packages/shared/src/data/trees/*.json`, `packages/shared/src/index.ts`, tests
- **Do:** Sequence, selector, parallel, inverter, cooldown, timeout, condition and action nodes with a `running` status; a typed blackboard; trees authored as JSON and validated at import, with conditions and actions looked up by name in a registry the server fills. Shared, not server, because it is platform-free logic (§3) — it imports nothing and reads no clock: time is the tick handed in, randomness the seeded PRNG.
- **Done when:** unit tests cover every node's success/failure/running semantics, re-entry into a running branch, a cooldown and a timeout measured in ticks, a tree referencing an unregistered action failing at load with its name, and two runs from the same seed producing the same sequence of actions.
- **Size:** M
- **Completed 2026-09-23.** `bt.ts` parses a tree file structurally (node types, unknown keys refused, non-empty children, positive whole tick counts, leaf `args` of numbers/strings/booleans — by hand, as `weapons.ts` explains) and every file in `data/trees/` is parsed when the module is imported into `TREE_DEFS`; `buildTree(def | id, registry)` resolves each condition and action against a `BtRegistry` the server fills and throws `tree '<id>': <path>: unregistered action '<name>'` at load. The compiled tree is flat and immutable; `instantiate({ seed, blackboard, ctx })` gives a brain its own run state and an `Sfc32`, and leaves see a frame of tick, rng, blackboard and ctx. Sequence and selector have memory by default (a running one resumes at its running child); `reactive: true` re-ticks from the first child and halts a later running child that an earlier one pre-empts — the guard-while-acting shape a combat tree needs. Parallel is `success: "all" | "one"`, finished children are not re-ticked within an activation and whatever still runs when it decides is halted. Cooldown starts on the child's success only (a failed attempt or a halt does not lock it out); timeout fails and halts a child running `ticks` ticks since it started, without ticking it that tick. Both compare absolute ticks, so they hold at T-3.08's every-third-tick cadence. Abandoned running actions get their optional `halt`; `tick` refuses a tick before the last; `runningPath()` names the running branch for T-3.09. `Blackboard<S>` is typed by its shape, every key present from construction, with `reset` and `snapshot`. One committed tree, `idle` (a single `idle` action), for T-3.08's idle brains. Tests (`bt.test.ts`, `blackboard.test.ts`): each node's three outcomes, memory re-entry, reactive pre-emption with halt, cooldown and timeout ticked every tick and every third, unregistered action and condition, nine malformed nodes, the committed tree, and 200 ticks of a random patrol equal across two runs of one seed and different under another.

#### T-3.08 — Brains on the session
- **Depends:** T-3.07
- **Files:** `packages/server/src/ai/Brain.ts`, `packages/server/src/session/Session.ts`, tests
- **Do:** A bot slot owns a brain; the session ticks brains at 10 Hz, staggered by netId across the three ticks so the load is flat, and path following at 30 Hz from the brain's latest intent. A human taking over a slot stops its brain on the same tick; a human leaving hands the slot to a fresh brain that starts from the entity's current state, not from where the old brain was (ADR-001). Per-brain cost is measured.
- **Done when:** tests assert each brain runs exactly every third tick and never on another, that the six brains are spread across all three phases, that a join stops a brain before its next input is produced and a leave restarts one, and that a slot's netId, position and health survive both swaps. `pnpm bot` numbers are unchanged with idle brains.
- **Size:** S
- **Completed 2026-09-23.** `Brain` (`server/src/ai/Brain.ts`) is one T-3.07 tree instance per bot slot: blackboard `BrainMemory { intent: LocomotionIntent | null }`, ctx the session's own `Slot` read live (netId, state, yaw, health), seed mixed from netId and the slot's `brainGeneration`. The server registry has one leaf, `idle` (clears the intent, runs forever), and the default tree is the committed `idle`. `Session` builds a brain for every slot at construction; `step` thinks every brain whose `netId % 3` is the tick's phase (netIds 1..6 → two per phase) before any input is consumed. `assignSlot` stops the brain — halting its running action, so its intent reads null — and drops its follower, so the tick after a join runs only the human's input; `releaseSlot` builds a fresh brain whose `startedAt` is the entity where the human left it, with a fresh blackboard. Locomotion: `SessionOptions.navMesh` (new fourth constructor arg, with `brainTree`); when set, each bot whose brain has an intent gets a `PathFollower` (made lazily, dropped once the intent goes null, after one idle input) and every slot goes through one `Avoidance` (made with the first follower, stepped every tick after, humans and idle bots as obstacles). A bot that has never wanted anything keeps its input untouched, so with idle brains — and with no navmesh, which is how the host, the page and `pnpm bot` build sessions today — the session is exactly what it was: `pnpm bot --count 2 --ticks 600` output is byte-identical before and after, in-process and over ws. Wiring the world's navmesh into `Registry`/`LocalServer` is left for the first tree that walks (it costs a few hundred kB in the page bundle, see `bakedNav.ts`). Tests (`Brain.test.ts`): 90 ticks with each slot's think ticks equal to exactly the ticks of its phase; six brains over all three phases, two on each of 30 ticks; a walking brain on the range moves its bot on every tick and arrives; a join between ticks stops the brain, halts its action, and the next input is idle; 30 human ticks produce no thoughts; the leave gives a new brain from the entity's current position; netId, position and health (after 30 damage) survive both swaps. Cost, logged: ~0.12 µs an idle think; best-of-five session step ~33 µs/tick with six idle brains, ~95 µs with six walking a 4 m goal (path following + avoidance).

#### T-3.09 — AI debug view
- **Depends:** T-3.08
- **Files:** `packages/shared/src/net/protocol.ts`, `packages/server/src/ai/debug.ts`, `packages/client/src/ui/AiDebug.ts`, `packages/client/src/main.ts`, tests
- **Do:** An opt-in `AiDebug` message — current tree path, intent, corridor, perception cones and known targets, chosen cover — sent only to clients that ask and only when the host allows it (`AI_DEBUG=1`), drawn by a client overlay on a free key. Nobody can judge an AI they cannot see the reasons of, and every 🧍 gate in this milestone runs with it available.
- **Done when:** tests assert the message round-trips; a host without the flag sends nothing and a client that did not ask receives nothing (bytes counted); the overlay's geometry is built from the message and nothing else. A browser run shows a bot's path and tree state over the world.
- **Size:** M
- **Completed 2026-09-23.** Protocol 17. The four-bit tag had one value left, so tag 15 is the AI debug family with a bit after it: `AiDebugRequest { on }` (client → host, reliable) and `AiDebug { tick, brains }` (host → client, unreliable, 10 Hz on ticks ≡ 0 mod 3). Each brain: netId, position, `runningPath()`, intent (goal + pace), corridor (the string-pulled points being walked), perception cones, known targets and cover — the last three always empty until T-3.13/T-3.18 fill them, so those tasks change no wire layout. Lists are capped on write and a count past its cap is a `ProtocolError` on read. `server/src/ai/debug.ts` builds the report read-only from the session's brains and followers. `Session` takes `aiDebug` in `SessionOptions`; `AI_DEBUG=1` (config → `Registry` → every room) turns it on, anything but 0/1 is a startup error. A host without the flag ignores and forgets requests; with it, only clients that asked are sent reports, and a leave or `on:false` drops them. The in-page `LocalServer` allows it (the page is its own host). `NetClient.requestAiDebug` remembers the wish and resends it on every JoinAck. `client/src/ui/AiDebug.ts`: `aiDebugGeometry(report)` is a pure function of the message (corridor legs, goal post and cross, cone edges and arc, target lines, cover square, a label per brain with its tree path and intent); `AiDebugOverlay` draws it as one `LineSegments` plus projected DOM labels, toggled with **B**. The old "unknown message type" test became "every tag is spoken for" (0x0f now decodes as a harmless stop request). Tests: round trips (requests, empty and full reports, every pace), caps; config; on the session over loopback, a flagless host sends 0 B to a client that asked, a flagged host sends 0 B to a client that didn't — byte-for-byte the same total it would get from a flagless host — and 30 reports in 90 ticks to the one that asked (~290 B each with five walking brains, ~2.9 KB/s); reports carry the walking tree's path, intent, corridor to the goal and position within 1/64 m; stop and leave end them; overlay geometry equals the reported points, is the same for the decoded bytes, and mutates nothing. Browser run (in-page session, Chromium): B shows "AI debug · tick N · 4 brains" and a label over each bot with `action:idle / no intent`. No path is drawn in the page yet because every committed tree is `idle` and the page's session has no navmesh — the corridor appears once T-3.08's deferred navmesh wiring lands with the first tree that walks; the session test covers the corridor on the real range mesh.

#### T-3.10 — Enemy entities
- **Depends:** T-3.08
- **Files:** `packages/shared/src/data/enemies.json`, `packages/shared/src/sim/enemies.ts`, `ecs/components.ts`, `net/schema.ts`, `net/protocol.ts`, `Session.ts`, `server/src/net/lagComp.ts`, tests
- **Do:** Enemies as the second class of entity that comes and goes, after projectiles: their own netId range, an archetype in data (health, weapon, perception block, accuracy block, tree id, `downable: false`), spawned and despawned by the session, stepped through `stepCharacter` with a brain of their own, recorded into the hitbox history every tick so a human's lag-compensated shot resolves against them exactly as against a slot, and hurt through `applyDamage`. An `Enemy` component (archetype index, faction) replicates beside `Transform`, `Velocity`, `Crouch` and `Health` (protocol bump). A dead enemy stays as a corpse for a data-set time, then despawns. Range targets stay in the range world.
- **Done when:** session tests over the real wire assert an enemy spawns, moves and despawns in the deltas a client decodes; a human's shot at an enemy's head at 20 m under 150 ms of simulated latency lands on the head zone; an enemy dies rather than going down, stops producing input the tick it dies, and despawns on schedule; enemy netIds never collide with slots, range targets or projectiles; `isRangeTarget` and the projectile test stay bounded.
- **Size:** L
- **Completed 2026-09-23.** Protocol 18. `sim/enemies.ts` parses `enemies.json` by hand (as `weapons.ts` explains): one archetype, `rifleman` — health 100, carbine, tree `idle`, `downable: false`, 10 s corpse, a perception block (`visionRangeM`, `fovDeg`) and an accuracy block (`baseConeDeg`) holding only what names them, for T-3.13 and T-3.16 to extend. `ENEMY_IDS` is the wire order (3 bits; T-3.23 appends the MG); unknown keys, weapons and trees fail at import. The `Enemy` component is `archetype` (3 bits) and `faction` (2 bits, 0 hostile to the squad), sent once on the spawn. **NetIds:** enemies take their own bounded band, 2000..16383 (`isEnemyNetId`); `FIRST_PROJECTILE_NET_ID` moved from 2000 to 16384 (one line in `ballistics.ts`, outside the Files list) because projectile ids count upward without bound — enemies could not sit above them without an eventual collision, and below 16384 a netId is a two-byte varuint, which is worth spending on forty long-lived enemies rather than a handful of grenades. `Session.spawnEnemy(archetype, { x, y, z, yaw?, faction?, tree? })` returns a netId, or null at `MAX_ENEMIES` (64, a rail) or when the band is spent; the enemy gets a `Brain` over its own body (the archetype's tree bound to the server registry, or the one passed). Each tick enemies think on their netId's phase, walk the intent through a `PathFollower` and the shared `Avoidance` (now sized for six slots plus the rail; corpses leave the crowd), step through `stepCharacter`, and are recorded into the hitbox history with slots and range targets, corpses included. Shots and blasts hurt them through `applyDamage`, which gained a `downable` argument (default true; one line in `damage.ts`, tested there): not downable, zero health kills. On the kill — a shot between ticks or a blast inside one — the brain stops, the follower goes and the input is idle, so no later step moves it; `thinkBrains` also stops any dead enemy's brain whatever killed it. A corpse is not stepped; once its corpse time is up it despawns and `HitboxHistory.forget` drops its track (without that a rewound shot still hits the despawned corpse — checked). The snapshot carries Transform, Velocity, Health (timer = corpse seconds left), Crouch and Enemy; no PlayerSlot, Vault or Weapon. Enemy brains appear in T-3.09's AI debug report. Range targets are untouched. No enemies are spawned by the host or the page yet — that is E-3.9's spawner — so every existing session is unchanged (`pnpm bot` output byte-identical). Tests (`server/src/session/enemies.test.ts`): over the wire, an enemy spawns with `Enemy [0, faction]` and no PlayerSlot, walks 2 m+ in the decoded deltas, is shot dead and despawns from them between 10 s and 10 s + one tick after its death; a head shot at 19.9 m through NetSim at **75 ms each way (150 ms round trip)** with the client rendering 100 ms behind, on an enemy walking across the line of fire at 4.2 m/s, lands on the head zone for the head-zone damage — the enemy is 1.1 m from where it was at the render time, and the same shot claiming no rewind misses; an enemy shot while walking is dead without ever reading downed on the wire, its brain stopped and input idle at the kill, and neither position nor thought count changes after; a frag at its feet kills it; 64 enemies, a projectile, the slots and the range targets share no netId, `isEnemyNetId` is true for enemies only, and a spawn after all 64 despawn gets a fresh id. `isRangeTarget` and the projectile test stay bounded (the latter now also asserts not `isEnemyNetId`). Shared: parser (full row, committed data, eleven malformed rows, wire order both ways), the bands, non-downable `applyDamage`, and a delta spawn carrying the `Enemy` component at its widest values. The 150 ms is read as round trip: at 150 ms each way the rewind (one-way + 100 ms) would pass ADR-012's 200 ms cap, and the clamp — not the enemy — would be under test.

#### T-3.11 — Enemies in the page
- **Depends:** T-3.10
- **Files:** `packages/client/src/net/NetClient.ts`, `packages/client/src/character/*`, `packages/client/src/main.ts`, tests
- **Do:** Draw enemies from the interpolation buffer on the same humanoid rig, pose driver, fire/reload layers, hit reactions and foot placement a remote soldier uses (T-2.22..T-2.28), in an enemy palette from the atlas (T-2.38) that reads as the other side at 40 m. A corpse holds its death pose and is removed when the entity despawns.
- **Done when:** tests assert an `Enemy` entity gets a soldier mesh in the enemy palette and a slot never does; that it is never handed to the squad's roster or HUD; that despawn removes every object it created. A browser run on the in-page session shows an enemy standing, walking and falling.
- **Size:** M
- **Completed 2026-09-23.** The remote-soldier drawing that lived inline in `main.ts` moved to `client/src/character/remoteSoldiers.ts`: `RemoteSoldiers` owns each remote's mesh, pose driver, feet, kick and last rendered position, and `update(net, dt)` draws every entity `NetClient.remotes()` returns and removes every one it no longer does — slots and enemies through the one path (rig, T-2.22 pose driver, T-2.25/26 weapon layer, T-2.27 hit reactions via the same `effects.flinch` lookups, T-2.28 feet). What an entity looks like is `remoteSoldierState(view, netId)`, a function of its components alone: an `Enemy` component means the `enemy` palette and the archetype's weapon (`enemyByIndex(...).weapon`; an enemy replicates no Weapon), and never asks the roster; a slot keeps T-2.33's roster-driven palette. `paletteFor` takes `enemy` first. **Enemy palette** (`soldierPalette.json`, standing rule 4): a cool slate uniform (`#5a6270`), near-black webbing and gear, oxblood accent — every squad palette is warm olive, so the uniform's mean hue flips sign (red − blue > 0 for all nine friendly palettes, < 0 for the enemy, a margin over 25) and the whole atlas (its 1×1 mip) is darker than every friendly one; asserted on averages because averages are what 40 m samples. **Corpse:** anything not alive lies in the `downed` pose (weapon hidden, no hit reaction, no feet) — a dead enemy holds it until despawn; a dead *slot* now lies too instead of standing. **NetClient:** `remoteEnemy(netId)` from the `Enemy` component; a remote absent from a snapshot is stamped gone and drawn until the render clock passes that moment, then dropped from `remotes()`, and forgotten (buffer, vitality, weapon, slot, enemy) a while after — the same horizon projectiles use; `reviveTargetNetId` skips enemies. `disposeSoldier` frees the hit capsule's, skin's and carbine's geometry and material and the skeleton on removal; the cached palette atlases and the shared weapon-model materials are left alone. **Outside the Files list:** `LocalServer` gains `LocalServerOptions { navMesh }`, `spawnEnemy` and `enemyNetIds`, and `server/package.json` exports `./nav/baked` and `./brain`, for **`?enemies`** (`client/src/net/qaEnemies.ts`): three riflemen on the in-page range — one standing at (−5, 40) facing the spawn line, two walking QA patrols at x = −15 and x = 14 — respawned after each despawn; only that page imports the navmesh bake, dynamically. And a pre-existing bug the browser run hit: the in-page session registered its connections at t = 0 but stepped on `performance.now()`, so choosing "Practise here" more than 5 s after the page loaded dropped the connection for a heartbeat timeout before its Join was read; `LocalServer` now runs the session on its own clock from its first step. Tests: `remoteSoldiers.test.ts` (a real `NetClient` fed real deltas into a real `RemoteSoldiers`): an enemy gets a skinned soldier with the rifleman's carbine in the enemy atlas and two slots never do, whatever the roster says; the enemy has no slot, is in no roster and is never the revive target; a dead enemy lies in the death pose and takes no reaction; despawn removes the mesh from the scene and `shootable`, fires `dispose` on all six owned geometries and materials, leaves the shared atlas alone and the slot untouched, and the client's state drains; leaving clears everything. `qaEnemies.test.ts`: the in-page session with the range navmesh spawns three, the standing one stays put, both patrols walk more than 3 m in 8 s, and of the eight remotes drawn exactly the three enemies wear the enemy palette. Palette selection and contrast in `soldierTexture.test.ts`; the late-click join in `LocalServer.test.ts`. **Browser run** (`?enemies`, in-page session, headless Chromium on SwiftShader): with B on, enemies 2000 (idle), 2001 and 2002 (patrol, corridors drawn) in slate among olive squadmates; in ADS at ~25 m, 2000 standing and 2001 mid-stride; a burst drops 2000 into its death pose (7 → 6 brains in the report), and at tick ~1000 its corpse is gone and a fresh 2003 stands in its place.

#### T-3.12 — Interest management
- **Depends:** T-3.10
- **Files:** `packages/server/src/session/Session.ts`, `packages/server/src/session/relevance.ts`, `packages/tools/src/bench-bandwidth.ts`, tests
- **Do:** ADR-012's ~120 m relevance radius, per client, from that client's slot: entities outside it are despawned from that client's view and respawned on re-entry through the delta path that already supports both. Slots are always relevant (the squad is always on the HUD). `bench:bandwidth` gains a scenario of six slots and forty moving enemies.
- **Done when:** session tests assert an enemy leaving the radius despawns for that client only and reappears with current state on return; a client's ack/baseline bookkeeping survives an entity leaving and re-entering; `pnpm bench:bandwidth` reports the 46-entity scenario under ADR-012's 18 KB/s target, or, if it is not, under the 40 KB/s review line with the reason written into ADR-012 as an addendum.
- **Size:** M
- **Completed 2026-09-23.** `server/src/session/relevance.ts`: `relevantView(snapshot, viewerNetId, previous)` is a pure filter over the session's one world snapshot — an entity carrying `PlayerSlot` is always kept (the squad is always on the HUD), anything else (enemies, projectiles) is kept within `RELEVANCE_RADIUS_M` = 120 m of the viewer's own slot, measured 3D on the snapshot's quantized positions, and a connection without a slot sees only the slots. Hysteresis: an entity already in the client's last view stays until 10 m past the radius (`RELEVANCE_HYSTERESIS_M`), so one pacing on the edge is not a full respawn every tick. `ClientView` keeps each client's own ring of the views it was sent (depth 64, as before), and `Session.broadcast` now diffs the client's current view against the view it was sent at its acknowledged tick — that is the whole mechanism: leaving is a despawn and re-entry a spawn with every component at its current value, through the delta path that already did both. The session's single shared `SnapshotHistory` is gone (nothing else read it); views live in a `WeakMap` keyed by connection. No wire change, no protocol bump; sessions without enemies are unchanged (`pnpm bot --count 2 --ticks 600` byte-identical before and after). Tests (`relevance.test.ts`): the filter — slots at any distance, 119 m in and 121 m out, the hysteresis band, measured from the viewer, slotless viewers, nothing copied or mutated; over the wire with two clients, an enemy despawns for the client whose slot moved 200 m away and not for the other (who still sees that slot at 214 m), is moved and hurt while away, and comes back into the first client's view at its current position and health with its `Enemy` component; a client acknowledging one delta in five and one acknowledging all, with an enemy pacing out of range and back three times, apply every delta, miss no baseline, carry a baseline on every delta after the first, and end matching the host. `pnpm bench:bandwidth` gains the 46-entity scenario on a real `Session` on the range: six slots (five walking bots and the seated client) and forty riflemen walking 14 m patrols in eight lanes × five rows, all within 120 m so the full cost is measured, one client acknowledging — **8.5 KB/s** (≈290 B/tick) received, inside ADR-012's 18 KB/s target, so no addendum; the bench asserts 45 of the 46 walked (the seated client's own slot stands). Outside the Files list: the bench's synthetic scenario had been broken since Health grew to six fields (T-2.13); its fixture now carries six.

#### T-3.13 — Vision and awareness
- **Depends:** T-3.07
- **Files:** `packages/shared/src/ai/perception.ts`, archetype perception block in `enemies.json`, tests
- **Do:** Pure functions of (observer, target, world): a view cone and range from the archetype, line of sight by `rayWorld` from the observer's eye to the target's shin, chest and head (the blast's probe shape), and an awareness level that *accumulates* over time in view — faster when close, moving, firing or standing, slower when crouched, prone or at the cone's edge — and decays out of view. Detection is awareness crossing a threshold, never a single visible frame.
- **Done when:** unit tests over fixture geometry assert a target behind a full wall is never seen and one behind a low wall is seen standing and not crouched; awareness rises monotonically in view and falls out of it; a prone target at 40 m takes longer to detect than a standing one; a target outside the cone is not seen at any range; all of it with table trig and no clock.
- **Size:** M
- **Completed 2026-09-23.** `shared/src/ai/perception.ts`: `sight(observer, target, world, perception)` → distance, in range, in cone, centrality (0 at the cone's edge to 1 dead ahead, linear in the cosine), exposure (clear fraction of `BLAST_PROBE_FRACTIONS` rays from the eye up the target's `stanceHeight`, stopping 1 mm short as the blast does) and visible; `inViewCone` is a dot product against `cos(coneHalfAngle)` from the table, horizontal about the observer's yaw; `awarenessRate` is distance (near → far on closeness²) × stance × motion × firing × edge × exposure, capped at `maxRatePerSec`; `stepAwareness(a, sighting, target, perception, dt)` rises by it in view and falls by `decayPerSec` out of it, clamped 0..1; `isDetected` is `a ≥ detectAt`. No state, no clock — time is the `dt` passed in. The rifleman's perception block gained `detectAt`, near/far/max rates, decay, crouch/prone factors, moving speed and factor, firing and edge factors; the parser validates each and refuses far > near and prone > crouched. Tests on fixture geometry with their own numbers: a full wall hides every stance forever; a 1.2 m wall a metre in front shows a standing head (exposure 1/3) and nothing crouched or prone; a mid-height bar hides the chest alone; outside the cone at seven ranges and five bearings nothing is seen; the edge sits within one table unit of the half angle at four yaws; monotone rise and fall; detection past the threshold and never on the first think (also for the committed rifleman at 30 and 10 Hz); prone at 40 m slower than crouched slower than standing (fixture and committed). Committed rifleman: 0.70 / 1.17 / 2.77 s standing / crouched / prone at 40 m. Not called by any brain yet, and T-3.09's debug cones stay empty — the Files list is shared-only; T-3.14 wires sight into memory on the session.

#### T-3.14 — Hearing, memory and target choice
- **Depends:** T-3.13, T-3.10
- **Files:** `packages/shared/src/ai/stimuli.ts`, `packages/shared/src/ai/memory.ts`, `Session.ts`, tests
- **Do:** The session emits stimuli — a shot (at the shooter), an impact and a near miss (at the point), a detonation, a sprinting soldier — each with a loudness radius in data. A brain's memory holds a last known position, time and confidence per target, fed by sight and by stimuli and decaying without either. Target choice prefers the visible, the close and the one shooting at it, and deprioritises the downed (data).
- **Done when:** tests assert a shot is heard inside its radius and not outside, an unseen shooter's last known position is where the shot came from, memory decays to forgotten on its data-set time, a visible target beats a remembered one, and a downed target is chosen only when nothing else is known.
- **Size:** M
- **Completed 2026-09-23.** `shared/src/ai/stimuli.ts`: five kinds — `shot` and `sprint` are *locating* (heard at the source, so they place it), `impact`, `nearMiss` and `detonation` are *threatening* (heard at a point, they say the source is shooting near the listener); which is which is the rule and lives in code, each kind's `radiusM` and `confidence` and the near-miss distance (`nearMissM`, 1.5 m, until T-3.16's capsule test replaces it) are `data/stimuli.json`, hand-validated as `weapons.ts` explains. `hears` is a sphere — through walls; occlusion is a tuning pass for when there is a building to hear through. `closestApproach` is the segment–point test the near miss uses. `shared/src/ai/memory.ts`: a `TargetMemory` is a `Map` of entries (position, `updatedAt`, confidence at that time, visible, downed, `threatAt`); confidence falls linearly to 0 over `forgetSeconds` and the entry is forgotten at exactly that age (a visible one never); `beginThink` clears visibility and drops the forgotten; `rememberSeen` is certainty; `rememberHeard` moves an unseen source's position to a locating stimulus and tops confidence up (never down), and marks a known source as a threat on a threatening one; `chooseTarget` scores (visible ? `visibleWeight` : confidence) × 1/(1 + d/`proximityM`) × (`threatFactor` while the threat is fresh), downed × `downedFactor` — committed 0, falling back to the best downed target only when nothing else scores. Tuning is its own `data/memory.json` rather than the archetype block, to stay inside the Files list; per-archetype memory is a later split if an archetype needs it. **Session:** `applyFire` emits a shot at the (rewound) eye once per trigger pull, and per pellet an impact at wherever it stopped and a near miss at the closest point to each living enemy it passed within `nearMissM` of (the present world, not the rewound one); `detonate` emits a detonation from the thrower; a slot stepping faster than halfway from walk to sprint with sprint held emits a sprint. `perceive` runs before brains think: every living enemy hears, each tick, the stimuli made by squad slots since the last step; on its think tick it steps awareness of each living slot by the think period through T-3.13's `sight`/`stepAwareness`, `rememberSeen`s the detected, forgets dead slots, and sets `enemy.target`. `EnemyEntity` gained `memory`, `awareness` and `target`. No tree reads them yet (T-3.15/T-3.20), and T-3.09's debug `targets` stay empty (debug.ts is outside the Files list). Sessions without enemies are unchanged: `pnpm bot --count 2 --ticks 600` byte-identical. Tests: `stimuli.test.ts` (parser, radius per kind and direction, the locating/threatening split, closest approach), `memory.test.ts` (parser; an unseen shooter placed at its shot and following the next; sight beats sound; threat without placement; linear decay and forgetting at the data time; top-up; visible beats remembered at four distance pairs with fixture and committed data; close and threatening preferred, threat wearing off; downed only when nothing else is known, and a soft factor a discount); `server/src/session/hearing.test.ts` over a loopback client: a shot heard by an enemy 5 m inside the committed radius and not by one 5 m outside, the unseen shooter's last known position equal to the eye the shot came from and chosen as target, forgotten within one think of `forgetSeconds`, a near miss past an enemy's shoulder marking a threat, a slot in view not detected on the first think and seen (and chosen) later, and a sprint heard where a walk is not.

#### T-3.15 — AI fire through the authoritative path
- **Depends:** T-3.10, T-3.13
- **Files:** `packages/server/src/session/Session.ts`, `packages/server/src/ai/aim.ts`, archetype accuracy block, tests
- **Do:** A brain pulls the trigger through the same fire path a human's `Fire` takes — same weapon data, cooldown, bloom, magazine and reload, same `HitEvent` — with no rewind, because a server-side shooter sees the present. Aim error comes from the archetype: a base cone widened by target distance and speed and by the shooter's own suppression, narrowed by time on target. An AI never fires without line of sight to what it is aiming at, except when suppressing (T-3.21).
- **Done when:** session tests assert an enemy's shot produces a `HitEvent` with its netId, damages a slot through `applyDamage` and can down it; over a seeded run of 300 shots at 20 m the hit rate lies inside the band the archetype's data describes; time on target narrows the spread; an enemy reloads when empty and cannot fire while reloading; and no shot is fired through a wall.
- **Size:** M
- **Completed 2026-09-23.** `server/src/ai/aim.ts`: the aim cone is `baseConeDeg` × (1 + distance/`distanceDoublingM`) × (1 + target speed × `speedFactorPerMps`) × (1 + suppression × `suppressionFactor`) × an acquire factor falling linearly from `acquireFactor` to 1 over `settleSeconds` of time on target, capped at `maxConeDeg`; the error is a uniform-disc sample of it as integer yaw/pitch deltas (as `pelletDirection` does), seeded from tick, netId and shot index; aim points are the capsule centre then the head (so a head over a low wall is a target and a soldier behind a tall one is not); line of sight is one `rayWorld` from the eye. The rifleman's accuracy block grew to nine validated fields, including `holdBloomDeg` (trigger discipline: no pull while the weapon's bloom is above it, so it fires bursts rather than spraying at the gun's worst cone) and `hitBand` — the rule-5 number, written beside the tuning: at 20 m against a standing, still soldier it lands 40–75 %. **Session:** the pellet loop of `applyFire` is now `traceShot`, shared by a human's rewound `Fire` and an AI's unrewound one. A brain pulls the trigger by setting `fireAt` (a netId, new on `BrainMemory` — `Brain.ts` is one line outside the Files list, the only place the trigger can live); `fireEnemies` runs every tick after everyone has moved and been recorded, finds a visible aim point on the target or holds fire (and resets time on target), turns the enemy to face it, and fires the archetype's `WeaponDef` through `tryFire` (aimed cone, bloom, cadence, magazine) and `traceShot`. `EnemyEntity` gained `weapon`, `weaponState`, `aim` and `speed`; enemies' bloom decays per tick like a slot's; the last round out starts a reload. Suppression is passed as 0 until T-3.16 exists; suppressive fire without sight is T-3.21's. Committed rifleman: 57.7 % of 300 shots at 20 m; mean error 3.86° in the first 0.15 s on target against 1.52° settled. Sessions without enemies unchanged: `pnpm bot --count 2 --ticks 600` byte-identical. Tests: `ai/aim.test.ts` (each factor, the ceiling, the disc sample's bounds and mean, points per stance, line of sight, head over a low wall); `session/aiFire.test.ts` (a `HitEvent` with the enemy's netId downing a slot through `applyDamage`, the hit band, time on target, reload gap ≥ `reloadSeconds` with no shot inside it, no shot at a soldier behind the east wall and shots once they step into the gap); `enemies.test.ts` refusals for the new fields.

#### T-3.16 — Suppression in the sim
- **Depends:** T-3.15
- **Files:** `packages/shared/src/sim/suppression.ts`, `packages/shared/src/data/suppression.json`, `ecs/components.ts`, `net/schema.ts`, `Session.ts`, tests
- **Do:** A near miss is a shot whose ray passes within a data-set distance of a soldier's capsule without hitting it; blasts and impacts nearby count too. Every soldier — slot or enemy — carries a suppression level that near misses raise and time decays. For AI it widens aim and raises the brain's urge to take cover (read by T-3.20). For humans it widens the weapon cone server-side by a data-set amount and replicates as a `Suppression` component so the page can show it (protocol bump).
- **Done when:** tests assert the closest-approach test against a capsule (miss by 0.4 m counts, 3 m does not, a hit is not a near miss); the level rises per near miss, saturates and decays on its curve; a suppressed shooter's measured spread is wider by the data's amount; the component round-trips and a client's local weapon cone mirrors the replicated level.
- **Size:** M
- **Completed 2026-09-23.** Protocol 20. `shared/src/sim/suppression.ts` + `data/suppression.json`: `passCapsule` is segment-against-segment (the round's path against the capsule's axis, both clamped) minus the radius — a gap ≤ 0 is a touch, which is a hit, and `isNearMiss` is 0 < gap ≤ `nearMissM` (1.0 m); `capsuleGap` is the same for a point. The level is a hold and a line: it stays where the latest raise left it for `holdSeconds` (0.75), then falls at `decayPerSec` (0.35/s), as a function of time since that raise — reading it steps nothing; `raiseSuppression` adds on what is left and saturates at 1. Raises: 0.2 per near miss, 0.08 per impact within `impactRadiusM` (2 m) of the capsule's surface, and a blast `blast` × (1 − d/`blastRadiusM`) (0.6 at the feet, 10 m). Impact distance is to the surface, not the chest as first written: from the chest the impact band sat almost wholly inside the near-miss one. `suppressionConeUnits` is `coneDeg` (1.5°) × the level *as the wire carries it* (6 bits, 1/63 steps), added to the weapon cone past its clamp and stance (`currentConeUnits`/`tryFire` gained an `extraUnits` argument, `weapons.ts` outside the Files list), so a suppressed shooter is wider by exactly the data's amount and the page, given the replicated level, computes the same cone. **One near-miss rule:** the session's near-miss stimulus now uses the capsule test too, and `stimuli.json`'s chest-distance `nearMissM` is gone (as T-3.14's note foresaw; `stimuli.ts` outside the Files list). **Session:** every slot and enemy carries a `SuppressionState`; per pellet, against the present world, every living soldier of the other side (a slot's side is the squad, an enemy's its faction — the squad's own fire and grenades pin none of the squad) that the round nearly missed or whose capsule the impact landed near is raised; a detonation raises the thrower's other side by distance. A human's `Fire` widens by `suppressionConeUnits(level)`; an AI's aim reads the level through its archetype's `suppressionFactor` (T-3.15); T-3.20 reads `enemy.suppression` for the urge to take cover. Respawn clears a slot's. The `Suppression` component (id 10, `level` 6 bits) rides every slot's entity and is resent only when the wire level changes. **Page:** `NetClient.suppression` is the local player's replicated level; `CombatQA` passes it to `tryFire` and `coneDegrees`, so the predicted tracers and the crosshair gap widen with the real shot (the vignette, desaturation and jolt are T-3.17's). Measured: a carbine's widest error over 400 aimed shots 0.419° plain, 1.883° at full suppression (+1.46° against the data's 1.5°); the rifleman's mean aim error at 20 m 1.44° plain, 3.55° fully suppressed. Tests: `suppression.test.ts` (parser; 0.4 m counts, 3 m does not, a hit and a graze are not; the cap over the head; a round stopped short; slanted path; point gap; rise, saturation, hold and line, a raise mid-decay; blast falloff; wire round-trip; the cone exactly `coneDeg` wider, past the gun's ceiling, and the shot leaving with it); `delta.test.ts` (the component at four levels, resent only on change); `server/src/session/suppression.test.ts` over a loopback client (0.4 m past an enemy raises it by `nearMiss`, 3 m and a square hit do not; eight near misses rise monotonically to 1, hold, fall on the line to 0; a round striking the wall 1.3 m from an enemy raises it by `impact`; a squadmate 0.2 m off the line is not raised; spread widened by the data's amount ± 0.15°; a suppressed enemy's aim wider; the snapshot's `Suppression` is the decaying server level); `client/src/weapons/suppressedCone.test.ts` (a real `NetClient` reads the level and `CombatQA`'s cone at it equals the server's at three levels). A blast raising the level is unit-tested only (`blastSuppression`), not through a thrown grenade on the session.

#### T-3.17 — Suppression in the page
- **Depends:** T-3.16
- **Files:** `packages/client/src/ui/*`, `packages/client/src/camera/cameraShake.ts`, `packages/client/src/main.ts`, tests
- **Do:** Being suppressed reads on screen: a vignette and desaturation scaled by the replicated level, a small camera jolt per near miss, and the crosshair's cone showing the widened spread. Stateless per frame like every other effect.
- **Done when:** tests assert the effect is zero at zero suppression and monotonic in it, that 30 and 120 fps render the same picture at the same level, and that the crosshair cone equals the replicated spread. A browser run with a bot firing past the camera.
- **Size:** S
- **Completed 2026-09-23.** `client/src/ui/suppressionLook.ts`: `suppressionLook(level)` is a pure function of the replicated level alone — vignette opacity up to 0.75 with its clear centre closing from 70 % to 40 % of the way out, and saturation down to 0.4 — eased on a square root so one near miss already reads (0.2 → ~45 %), monotonic, exactly nothing at 0. `SuppressionOverlay` writes it only on change to a fixed layer first in `<body>`: under the reticle, banners and panels, over the unpositioned canvas. The desaturation is a `backdrop-filter` on a layer of its own, not a `filter` on the canvas: a filter gives the canvas its own stacking context, which in the browser run painted it over the vignette *and* the HUD — found by measuring the screenshot, not by the unit tests. `camera/cameraShake.ts`: `suppressionJolt(from, to)` — the page is told the level, not each near miss, so a rise is felt as rise/`SUPPRESSION.nearMiss` near misses' worth of a 2 cm / 0.6° impulse (capped at three), and a fall is nothing; `main.ts` adds it on the frame that sees the rise. The crosshair's gap function moved from `main.ts` to `ui/crosshair.ts` (`crosshairGapPx`) so it can be tested; its cone has been the replicated one since T-3.16. **`?suppress`** (`qaEnemies.ts`, outside the Files list, a QA fixture beside `?enemies`): one rifleman 25 m up the lane firing at slot 1's soldier 1.5 m beside the player, so rounds go past the camera. Tests: `ui/suppressionLook.test.ts` (nothing at zero; monotonic over 100 steps and full at full; a jolt per near miss, proportional, none on the decay; a film of two near misses, the hold and the decay rendered at 30 and 120 fps sampled at the same moments — same vignette and saturation exactly, shake within 3.5e-16; the crosshair gap at four wire levels equals the gap of the server's cone at that level), `net/qaEnemies.test.ts` (`?suppress` raises the player's replicated level to 1.00 in 30 s and keeps one shooter). **Browser run** (Chromium via Playwright, `?suppress`, in-page session): peak vignette 0.75 and `saturate(0.4)`, crosshair gap 26 → 42 px; the screenshot's bottom edge fell from luminance 110.7 / chroma 65 to 74.9 / 20.5, and every panel stays readable over it.

#### T-3.18 — Cover points in the bake
- **Depends:** T-3.04
- **Files:** `packages/tools/src/nav/cover.ts`, `packages/server/src/ai/nav/baked/*`, tests
- **Do:** Generate cover points along every box face a soldier can stand against, on the mesh: position, the face normal it protects along, and height class — **low** (crouch conceals, standing fires over) or **high** (standing conceals, fire by stepping out), from the box height against the crouched and standing eye heights. Stored beside the navmesh, under the same staleness hash.
- **Done when:** tests assert every point is on the mesh and within a capsule radius of its box; the low wall yields low points and the east/west walls high ones; no point is generated inside a box or in a gap too narrow to stand in; the counts per world are logged; editing a box fails the staleness test.
- **Size:** M
- **Completed 2026-09-23.** `tools/src/nav/cover.ts`: for every box and each of its four sides, points 1 m apart along the span where a whole body (one radius in from each end) is behind the face, standing one radius plus one voxel (0.45 m) off it — the vault approach's spacing rule, so each sits just inside the eroded mesh. A point is kept only if the box top above where it stands classes (`heightClass`: **high** at or over the standing eye, 1.55 m from the rig; **low** over the crouched eye, 0.95 m = `crouchHeight` less the standing crown-to-eye distance, since the rig has no crouched eye; nothing under it), the body's footprint overlaps no box above the step (`bodyBlocked`), and it is on the baked mesh (`onMesh`). That is what keeps points out of boxes, off faces pressed against a neighbour (crate A and B, 0.2 m apart) and out of gaps too narrow to stand in. Each point is `{ box, x, y, z, nx, nz, height }` with the face's outward normal — the soldier's side; the box shelters them from fire travelling along +normal — rounded to 0.1 mm so a re-bake writes the same bytes. **Stored beside the navmesh:** `BakedNav.cover` in `baked/<world>.ts`, written by `pnpm gen:nav` after the mesh and checked against it; `navBakeHash` now also covers the spacing, margin and eyes (`coverHashInputs`; an optional `eyes` argument), so the committed hash changed and was re-baked — the Detour bytes are identical. `bakedCoverFor(worldId)` in `bakedNav.ts` is T-3.19's way in. `bake.ts` imports `cover.ts` for the hash, and `cover.ts` imports only types back, so the two never form a load cycle. Range: **70 points, 32 low (crates, low wall), 38 high (the four long walls and the reference figure)**; posts are narrower than a soldier and rails are under the crouched eye, so neither gives any. Tests (`tools/src/nav/cover.test.ts`): eyes derived and the margin one voxel; class boundaries; the committed list equals a regeneration from live data, counts logged per world; every point on the mesh, its capsule 0 < gap ≤ one radius from its box, on the side its normal says; the low wall low on both faces and the four walls high on both; no point inside or overlapping a box, none between crates A and B; a 0.6 m corridor gets no inner points while a 2 m one gets both; a taller low wall or a lower crouch goes stale.

#### T-3.19 — Cover query and reservation
- **Depends:** T-3.18, T-3.13
- **Files:** `packages/server/src/ai/cover.ts`, tests
- **Do:** "Best cover from these threats": candidates within a path distance, scored by protection (line of sight from each threat's eye to the point's concealed probes is blocked), by a firing position existing (standing over low cover, or a side step out of high cover, has sight of the threat), by path cost, and against crowding friends. A point is reserved by whoever chooses it and released when they leave it or die.
- **Done when:** tests over fixture geometry assert a crate protects against a threat in front and not one behind; moving the threat round invalidates the point; two brains asking at once get different points; a point with no firing position is never chosen for combat; the query's cost for 40 brains is logged.
- **Size:** M
- **Completed 2026-09-23.** `server/src/ai/cover.ts`, tuning in `cover.json` beside it (hand-validated as `avoidance.json` is; a server-side table like that one, since the Files list names no shared data file). `CoverSystem(points, boxes, pathCost?)` over a world's baked cover (`bakedCoverFor`). **Protection** of a point from a threat's eye: no line of sight (`rayWorld`, the boxes the shots use) to any of the concealed body's three probes — shin 0.3 m, chest (the hitbox centre for the stance), eye — crouched at a low point, standing at a high one; scored as the fraction of threats hidden from, and a point hiding from none is no candidate. **Firing position**: standing up in place at a low point; a side step of `sideStepM` (1.2 m) either way along a high point's face, footprint clear of every box; the standing eye there must see the threat's eye. `combat` (the default) drops points without one; to hide (`combat: false`) they stay, and the firing bonus counts for nothing. **Score** = 10 × protection + 4 if a firing position (combat) − 0.2 per path metre − 3 per friend within 2.5 m; candidates within 30 m, ties to the baked order, no randomness. **Cost**: line of sight depends only on the threat and the geometry, so each threat eye's view of every point is computed once and shared by every brain asking (a 64-entry cache keyed by the eye's exact position); paths are found branch-and-bound — every candidate first scored with its straight-line distance, which a path is never shorter than, and pathed in that order only until the next optimistic score cannot beat the best real one — exact, and checked against the full ranking. **Reservation**: `choose(owner, query)` reserves the best point and releases whatever the owner held; others' points are not candidates; `track(owner, feet, alive)` releases on death, and once the holder has come within `arriveM` (0.6 m), when it is more than `leaveM` (1.5 m) away; `stillProtects(owner, threats)` is whether its point still hides it from every threat (T-3.20's flank check). Not wired into the session or any tree yet (T-3.20). Tests (`ai/cover.test.ts`, fixture geometry: a 1.2 m crate and a 10 m, 2.4 m wall): parser; probes by class; a crate protects against a threat in front, not behind or beside; low fires standing, high only where a side step clears the wall; moving the threat round (east, behind) invalidates the point and a re-ask offers nothing; two brains asking at once get different points and a third none; a mid-wall point with no firing position is never chosen for combat though nearer, and is chosen to hide; shorter walk preferred, crowding avoided; protection fractional; unreachable and too-far points dropped; release on leaving after arrival (not while walking there), on death, on asking again. On the range's committed cover and mesh, **40 brains against the six spawn eyes: 6.4 ms warm (160 µs each), 23.3 ms cold, 36 path queries, 30 got distinct cover**, each hiding from at least one threat and able to fire on one; without the shared sight it was 122 ms.

#### T-3.20 — The rifleman's fight
- **Depends:** T-3.05, T-3.14, T-3.15, T-3.19
- **Files:** `packages/shared/src/data/trees/rifleman.json`, `packages/server/src/ai/actions/*`, tests, `packages/tools/src/sim-run.ts` (scenario)
- **Do:** A tree that engages from cover: detect → move to cover facing the threat → peek, fire a burst, return → reload in cover → relocate when the cover is flanked (the threat can see the concealed probes) → advance cover to cover when unopposed. Suppression and damage push it toward cover; a clear target and full magazine pull it out.
- **Done when:** a seeded `pnpm sim-run --scenario cover-duel` against a scripted shooter reports and asserts, over 20 seeds: the enemy reaches cover within a data-set time of first contact in at least 90 % of runs; it spends under a data-set fraction of the fight exposed while not firing; it never reloads exposed when cover is in reach; a shooter moved to its flank makes it relocate within a bound. The numbers are logged every run.
- **Size:** L
- **Completed 2026-09-23.** **Tree** `data/trees/rifleman.json` (registered in `TREE_DEFS`; `parseTreeDef` now allows a top-level `$comment`, as every other data file does): with a threat known — relocate when its point is **flanked**; **in cover**, reload when low (≤ 30 %), advance when **unopposed** 5 s (a point ≥ 4 m nearer the target, never inside 12 m), peek and fire a 1 s burst unless **pressured** (suppression ≥ 0.35 or hurt within 1.5 s; one peek per 1.5 s cooldown), else stay down; out of cover, **take cover**; with none, fight in the open. Nothing known: stand down. Every number is a leaf's `args`. **Leaves** `server/src/ai/actions/rifleman.ts` on the server registry, over `actions/combat.ts`'s `CombatBody` (an `EnemyEntity` is one) and `CombatWorld` (cover, boxes, time, soldiers' eyes, friends), failing on a body that is not a fighter. `threatEye`: a visible target's live eye, else its remembered position lifted to eye height. A peek over low cover stands up and crouches again; out of high cover it side-steps to T-3.19's firing position and back (each step capped at 1.2 s, so a position the mesh will not quite reach does not stall it), and counts as still in cover while out on the step — without that, the step that makes a peek useful pre-empted it. `reload` walks back to the point and waits for the crouch before asking. Arrival is 0.4 m: the follower stops within 0.25 m of the goal *as snapped onto the mesh* and a baked point may sit 0.1 m off it, so anything tighter left the rifleman stopped and never arrived. **Brain** (`Brain.ts`): `BrainMemory` gained `crouch`, `reload`, `lookAt`, `phase`, `phaseAt` (`freshMemory()`), `Brain.read(key)`, `BRAIN_TICKS_PER_SECOND`. **Session**: takes the world's baked cover through `SessionOptions.cover`, as it takes the navmesh — importing the bake would put every world's into the page — and builds a `CoverSystem` with mesh path cost; each enemy carries `lastDamagedAt` and the shared `combat` view; `enemyHands` writes a brain's crouch into its input, starts the reload it asks for (settling a finished one first: a standing request restarted every reload on its finishing tick, unfilled — found by the duel, pinned by a test), and turns a walk to face `lookAt` by rotating the move so the ground covered is the follower's; cover reservations are tracked each tick and released on death. An enemy now fires from its own eye in its stance, so a crouched one behind low cover has no shot a standing one would. **T-3.19 amended**: a point's concealed probes now include both edges of the body along the face (±hitbox radius) — at a wall's end the centre line hid while a shoulder stood out and was hit, which kept the rifleman pressured and never peeking; the cover query's `CoverQuery.accept` filter serves `advance`. **Scenario** `pnpm sim-run --scenario cover-duel` (`tools/src/scenarios/coverDuel.ts`, thresholds `cover-duel.json`): a rifleman ~27 m up range against slot 0 as a real client firing 0.5 s bursts every 1.5 s at whatever of it shows (1.5 ° seeded error), moved to the rifleman's flank 8 s after it first reaches cover; other slots parked out of sight; both healed each tick. Over 20 seeds (3.7 s): **cover within 5 s in 100 % of runs (2.8–4.0 s; floor 90 %), worst exposed-while-not-firing 13.1 % of the fight (ceiling 20 %), 0 ticks reloading exposed while holding cover (a flank that lands mid-reload is the relocation's to measure), flanked in 20/20 and relocated within 1.13 s at worst (ceiling 3 s), 2–59 rounds fired per run (floor 1)**; exits 1 on any miss. The rifleman archetype's own tree stays `idle` — T-3.23 wires the archetype, and every test that spawns a rifleman relies on it standing still; the scenario and tests pass the tree. `pnpm bot` byte-identical. Tests: `tools/src/scenarios/coverDuel.test.ts` (every threshold over all 20 seeds; the gate fails each stricter threshold by name; a seed reproduces); `server/src/ai/actions/rifleman.test.ts` (tree binds; a non-fighter stands down; with a threat and cover it reaches a point that hides it; unopposed it advances 34.7 → 28.2 m and never inside 12 m; a walk east facing north; crouch held and released; a reload kept asked for completes; crouched behind the low wall no shot, standing shots); `cover.test.ts` (edge probes; a shoulder past a wall's end is not protected).

#### T-3.21 — Suppress and flank
- **Depends:** T-3.20, T-3.16, T-3.06
- **Files:** `packages/server/src/ai/group.ts`, `packages/shared/src/data/trees/*.json`, `packages/server/src/ai/nav/NavMesh.ts`, tests, sim-run scenario
- **Do:** Enemies spawned together share a group blackboard. When a target is pinned in cover, the group assigns a suppressor — firing at the target's last known position and its cover, without line of sight, to keep its suppression high — and a flanker, which paths with a query filter that penalises polygons the target can see, to a cover point with sight of the target's concealed side.
- **Done when:** a seeded `sim-run --scenario pinned` against a scripted soldier holding cover reports and asserts that the soldier's suppression level stays above a data-set floor for most of the flank, that the flanker reaches a position with line of sight to the concealed side in at least a data-set share of seeds, and that the flanker's route is measurably less exposed than the direct one.
- **Size:** L

#### T-3.22 — AI grenades
- **Depends:** T-3.20
- **Files:** `packages/server/src/ai/throw.ts`, `Session.ts`, tree data, tests
- **Do:** A target that has been static in cover for a data-set time is a grenade target. The brain searches launch pitch through `projectileArc` (T-2.30 — the same stepper the server flies it on) for an arc that ends within the blast's reach of the target and not of itself or a friend, then throws through the same session path a human's `Throw` takes, from the same pouch and cooldown.
- **Done when:** tests assert a thrown AI grenade lands within blast reach of a crouched target behind the low wall; no throw is chosen whose landing point is within blast reach of the thrower or a group member; the pouch and cooldown hold; a moving target is not thrown at.
- **Size:** M

#### T-3.23 — Rifleman and MG
- **Depends:** T-3.21, T-3.22
- **Files:** `packages/shared/src/data/enemies.json`, `packages/shared/src/data/weapons.json` (an LMG entry), trees, tests, sim-run scenario
- **Do:** The two slice archetypes (ADR-015). The rifleman is T-3.20/T-3.21's tree. The MG deploys before it fires (data-set time, stationary), fires long bursts with a wide cone, is the group's preferred suppressor, relocates rarely and badly, and is the thing the marksman exists to answer. RPG, sniper and officer are valid in the schema and absent from the data.
- **Done when:** schema tests accept all five archetype shapes and the data contains exactly two; a seeded scenario asserts the MG's suppression dealt per second is at least a data-set multiple of the rifleman's, that it relocates less often, and that it cannot fire while not deployed.
- **Size:** M

#### T-3.24 — 🧍 Combat AI sign-off
- **Depends:** T-3.11, T-3.17, T-3.23
- **Files:** `docs/playtests/e3-5.md`
- **Do:** Two people on the host, AI debug available, against a mixed group of riflemen and an MG in the range world. Do enemies take cover in a way that reads as a decision rather than a coincidence; does the MG pin you; does being flanked feel like being outplayed or like being cheated; does a grenade come when you camp; can you tell an enemy from a squadmate at 40 m. Tune the archetype data while the feel is in hand.
- **Done when:** a written verdict, on a run sheet prepared before the session as `e2-2.md` was, naming what it does and does not establish (it does not establish the mission, T-3.36).
- **Size:** S

#### T-3.25 — Formation following
- **Depends:** T-3.06, T-3.08
- **Files:** `packages/server/src/ai/friendly/formation.ts`, `packages/shared/src/data/squad.json`, trees, tests
- **Do:** The six slots split into two fireteams of three (§1.2), fixed in data. A friendly bot follows its fireteam's lead — the first human in the fireteam, else the first human in the squad, else slot 0's bot — at a formation offset (wedge, file) projected onto the mesh, walking when the lead walks and sprinting when they sprint, and closing up when the lead stops.
- **Done when:** headless tests with one human stand-in walking a route assert each bot stays within a data-set band of its formation slot for most of the route, rejoins after a corner, never takes the lead's own position, and that the lead changes correctly as humans join and leave fireteams.
- **Size:** M

#### T-3.26 — Friendly bots fight and revive
- **Depends:** T-3.25, T-3.20
- **Files:** friendly trees, `packages/server/src/ai/actions/*`, `Session.ts`, tests
- **Do:** A friendly bot uses the same perception, fire, cover and grenade actions an enemy does, bounded to its formation: it takes cover near its slot rather than roaming, holds fire when a squadmate is on the line of fire (segment against friendly capsules), and revives a downed squadmate — lifting today's `reviver.isBot` exclusion so a bot revives through the same held-interact path and the same range and timer a human uses.
- **Done when:** session tests assert a bot revives a downed human in the same time a human reviver would; a bot never fires when a friendly capsule is on the segment; a bot under fire takes cover within its formation band; a seeded scenario of five bots against a rifleman group reports and asserts kills without friendly hits.
- **Size:** M

#### T-3.27 — Orders on the wire
- **Depends:** T-3.08
- **Files:** `packages/shared/src/net/protocol.ts`, `packages/shared/src/sim/orders.ts`, `Session.ts`, tests
- **Do:** An `Order` message — move, attack, hold, regroup, revive — with a point or a target netId, addressed to one bot, a fireteam or all, and a `Mark` message for target marking. Untrusted: the sender must be a human in the session, a target must exist, and an order to a human-held slot is dropped (ADR-001: any player may order any *bot*). The last order to a bot wins, whoever gave it, and the session broadcasts each bot's current order and each mark so every client can show them (protocol bump).
- **Done when:** protocol round-trip tests; session tests assert an order from a human reaches the named bots and not others, an order to a human slot is ignored, two humans ordering the same bot leave the later order standing and both clients see it, marks expire on their data-set time, and garbage fields are refused.
- **Size:** M

#### T-3.28 — Bots carry out orders
- **Depends:** T-3.27, T-3.26, T-3.19
- **Files:** friendly trees, `packages/server/src/ai/friendly/orders.ts`, tests
- **Do:** An order pre-empts the formation branch through the blackboard: move goes to the point and takes the best cover there facing the likeliest threat; attack prioritises the target and advances to a firing position; hold stays and engages from where it stands; regroup returns to formation; revive goes and revives the named soldier. A marked enemy outranks unmarked ones for every bot. An order finishes, fails (unreachable, target dead) or is replaced — and says which.
- **Done when:** headless tests per order kind assert the bot does the thing and reports completion; an unreachable move reports failure rather than standing still silently; a hold survives contact; a marked target is engaged before a closer unmarked one.
- **Size:** M

#### T-3.29 — Order wheel and marking in the page
- **Depends:** T-3.27
- **Files:** `packages/client/src/ui/OrderWheel.ts`, `packages/client/src/input/LocalInput.ts`, `packages/client/src/main.ts`, tests
- **Do:** Hold Q for a radial wheel, choose by mouse direction, release to issue it at the point under the converged aim (the same raycast the crosshair uses); number keys while held pick one bot or a fireteam. A tap of F marks the enemy under the crosshair. Current orders and marks are drawn in the world from what the server broadcasts. No held modifier combos (R13).
- **Done when:** tests assert the wheel's direction-to-order mapping, that the order's point is the aim convergence point, that a release latches like the throw's release so a quick flick is never lost, and that the in-world markers are built from the broadcast state and not from what this client sent. A browser run issues each order to a bot on the in-page session.
- **Size:** M

#### T-3.30 — 🧍 Squad command sign-off
- **Depends:** T-3.11, T-3.25, T-3.26, T-3.28, T-3.29
- **Files:** `docs/playtests/e3-8.md`
- **Do:** One person with five bots, then two people sharing them. Do the bots feel like a squad or like followers; does an order get done the way it was meant; does the wheel stay out of the way in a firefight; do bots revive you when it matters; does sharing bots between two humans cause confusion about who is in charge.
- **Done when:** a written verdict, on a run sheet prepared before the session, naming what it does and does not establish.
- **Size:** S

#### T-3.31 — The grey-box mission map
- **Depends:** T-3.02, T-3.04, T-3.18
- **Files:** `packages/shared/src/data/worlds/greybox-01.json`, its bake under `server/src/ai/nav/baked/`, tests
- **Do:** A second world in boxes, sized for a six-man element: a squad start, an objective area, and **two viable approach routes** (§1.2) — one with long sight lines for an overwatch fireteam, one with close cover for an assault fireteam — plus enemy spawn zones behind the objective and on both routes. It is a fixture for M3's exit gate, not E-4.3's level format.
- **Done when:** tests assert both routes are connected paths on its navmesh from start to objective that share no polygon for a data-set share of their length; every spawn zone is on the mesh; each route has cover points along it; a soldier walks either route in the controller without getting stuck (headless, path following); the bake is committed and fresh.
- **Size:** M

#### T-3.32 — Encounters and spawning
- **Depends:** T-3.10, T-3.31
- **Files:** `packages/shared/src/data/encounters/*.json`, `packages/server/src/ai/director/spawner.ts`, `Session.ts`, tests
- **Do:** An encounter file per world: groups (archetypes, counts, spawn zone, initial posture — patrol, hold, garrison), triggers (the squad entering a zone, a group dying, a time since start) and reinforcement waves. The spawner never places an enemy where any human can see it (line of sight from every human's eye to the spawn point's probes), and caps enemies alive.
- **Done when:** tests assert groups spawn on their triggers and not before; a spawn point visible to a human is skipped for the next valid one; the alive cap holds under repeated waves; posture is honoured on spawn.
- **Size:** M

#### T-3.33 — The director
- **Depends:** T-3.32, T-3.14
- **Files:** `packages/server/src/ai/director/director.ts`, `packages/shared/src/data/director.json`, tests
- **Do:** An intensity estimate from recent damage to the squad, enemies in contact and squad suppression; waves are held while intensity is high and brought forward while it is low, inside the encounter's bounds. Enemy counts and wave sizes scale on **human count, not squad size** (ADR-001), from a table in data — five bots add nothing.
- **Done when:** tests assert one human and five bots get the table's one-human budget and six humans the six-human budget; swapping a bot for a human mid-mission changes the next wave, not the current one; a wave is delayed while intensity is above its threshold and never delayed past the encounter's maximum.
- **Size:** M

#### T-3.34 — The objective
- **Depends:** T-3.31, T-3.32
- **Files:** `packages/server/src/session/mission.ts`, `packages/shared/src/net/protocol.ts`, `packages/client/src/ui/*`, tests
- **Do:** Exactly what the exit gate needs: one objective type — clear the objective area and hold it for a data-set time — evaluated on the server, a `Mission` state message (in progress, complete, failed on a squad wipe), a HUD line, and a restart that resets the encounter and respawns the squad on the start line. Everything else is E-4.4's.
- **Done when:** session tests assert completion when the area is clear and held, failure when every slot is dead, and a restart that puts the world back to the start state; the message round-trips and the HUD reads it.
- **Size:** M

#### T-3.35 — The mission, headless
- **Depends:** T-3.23, T-3.28, T-3.33, T-3.34
- **Files:** `packages/tools/src/sim-run.ts` (scenario), `packages/tools/src/bench-tickrate.ts`, `.github/workflows/ci.yml` (a short-seed job), tests
- **Do:** `pnpm sim-run --scenario mission --seeds 20` plays greybox-01 with six friendly bots against the encounter, at the director's one-human and six-human budgets (a test override of the human count — the one place a bot is counted as a person, and only in this tool). Report completion rate and time, and the exit gate's two claims as numbers: the share of time enemies under fire spend in cover, and suppression episodes per engagement. Measure AI cost per tick at forty enemies and five bots.
- **Done when:** the scenario asserts a completion rate floor at both budgets, an in-cover share and suppression rate floor, and AI cost under the proposed 25 % of the tick; every number is logged every run, and a three-seed version runs in CI. A failing seed prints the seed.
- **Size:** M

#### T-3.36 — 🧍 M3 exit gate: one player, five bots
- **Depends:** T-3.24, T-3.30, T-3.35
- **Files:** `docs/playtests/m3-solo.md`
- **Do:** One person plays greybox-01 with five bots, start to finish, at least twice — once by each route. Do enemies demonstrably take cover and suppress; is the mission completable; do the bots pull their weight without being ordered every ten seconds.
- **Done when:** a written verdict on a run sheet prepared before the session, stating whether this half of M3's exit gate passed.
- **Size:** S

#### T-3.37 — 🧍 M3 exit gate: six players
- **Depends:** T-3.35
- **Files:** `docs/playtests/m3-six.md`
- **Do:** Six people on the deployed host play the same mission, same encounter file, no bots. Does it hold up at the six-human budget; does the two-fireteam split happen on its own; does the host hold its tick and bandwidth with six real sockets and a full encounter (netgraph and `/healthz` recorded). Best run after T-3.36, since it is the cheaper session to reschedule.
- **Done when:** a written verdict on a run sheet prepared before the session, stating whether this half of M3's exit gate passed. M3 closes when both T-3.36 and T-3.37 have.
- **Size:** S

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
| R13 | **A held-modifier keybinding collides with a browser-reserved shortcut** — Ctrl bound to crouch meant Ctrl+W (crouch-walk forward) reads to the browser as "close tab" and no page-side `preventDefault` can stop it; those reserved combos (Ctrl+W/T/N and a handful of others) are blocked from page script by design in every major browser, not a bug to work around in this codebase | High (playtests: closes the tab under the tester) | B-06: crouch moved off Ctrl entirely, onto a toggle on C (`LocalInput.crouchToggled`) · **standing rule: no future keybinding may put Ctrl, Alt, or Meta in a *held* combo with another game key** — a tap-only modifier use (if any) is fine since there's nothing to combine with a second keydown · **implemented:** clicking into the canvas now also requests fullscreen and arms `navigator.keyboard.lock()` (`packages/client/src/input/keyboardLock.ts`), the browser-sanctioned way for a page to reclaim reserved shortcuts — Chromium-only (Firefox/Safari have no `navigator.keyboard.lock` and silently fall back to ordinary `preventDefault`), refused locks (no user activation, one already active) also fall back rather than breaking the game, and it self-corrects on any fullscreen exit (Esc held, F11, browser UI) via `fullscreenchange` rather than needing every exit path handled by hand; still not something a player can turn off from browser settings on its own, and OS-level key remapping (AutoHotkey/Karabiner/xremap) remains a tester's fallback on non-Chromium browsers | M2 |

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

**Current milestone: M2. Updated 2026-09-22.** M1 and M1.5 are closed. E-2.1,
E-2.4, and E-2.6 are built and human-signed off; E-2.2, E-2.3, E-2.5 and the
soldier's look (§7.7) are built and waiting on their gates. CI remains green,
including the non-V8 parity job. **Four human gates are now queued behind one
session** — T-2.24, T-2.29, T-2.34 and T-2.39 all want two people on the host,
and all four can be judged in one sitting from their run sheets.

1. **Run the four gates together — once their run sheets exist.** 🧍 T-2.24
   (E-2.2 locomotion, run sheet `docs/playtests/e2-2.md`, prepared and not
   run: the bots never shoot, so crawl, revive and remote believability cannot
   be judged alone), 🧍 T-2.29 (E-2.3's layers: does the body read what the
   other person is doing), 🧍 T-2.34 (E-2.5: does the arc read where the
   grenade is going, and does cover matter) and 🧍 T-2.39 (the soldier's look,
   §7.7: does it read as 2002 rather than as untextured geometry, and are
   soldiers distinguishable at 40 m — it owes one open decision, section 6 of
   `docs/playtests/soldier-look.md`, whether to render at a fixed low
   resolution and upscale with point filtering, which trades crosshair and
   tracer legibility that T-2.24 and T-2.29 are also judged on). **Only two of
   the four run sheets actually exist:** `e2-2.md` and `soldier-look.md`.
   `docs/playtests/e2-3.md` (T-2.29) and `docs/playtests/e2-5.md` (T-2.34) are
   missing even though their task bodies describe them as prepared "as
   `e2-2.md` was" — they were not. Writing those two run sheets is real,
   unblocked build work: nothing in the build blocks any of the four gates,
   but two of them have nothing for the owner to run yet.
2. **Tune `projectiles.json` with the feel in hand.** The blast radius, the
   fuse, the throw speed and the roll are guesses measured only against
   arithmetic: a level throw travels about 17 m including the roll, the rocket
   reaches 43 m before its sag puts it in the ground, and a frag at your own
   feet takes a third of your health off. Whether any of that is *right* is
   what T-2.34 is for, and every one of them is a number in data.
3. **Keep tuning the rest of the data opportunistically.** Weapon and downed
   values remain data-driven; adjust them when a concrete playtest issue
   appears rather than reopening completed gates without a reason.

E-2.7 (combat audio) is the last M2 epic and remains an epic until its turn;
it is the one that needs assets bought or made (R1, §9 Q2), which is a
decision worth taking deliberately rather than on the way past. M2's exit gate
remains the overall human judgement that third-person combat feels good — and
with grenades in, that firefight now has something in it that the other person
has to move away from.

**M3 is broken out (§7.9, 2026-09-22), ahead of M2's exit gate, at the
owner's request.** It does not jump the queue: M2's remaining build task
(T-2.42) and its gates still come first. The first M3 tasks with nothing in
front of them are T-3.01 (the ⚠️ Recast spike — do this one early, because
ADR-006's choice is only as good as Recast running in all three browser
engines as well as Node), T-3.02 (named worlds) and T-3.07 (the behaviour
tree runtime). §7.9 records four scope calls made while breaking it out —
two archetypes not five, unclassed order authority, a minimal mission, and a
proposed AI CPU budget — for the owner to overrule at the first M3 gate if
any is wrong.
