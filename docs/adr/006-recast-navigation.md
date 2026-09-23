# ADR-006: recast-navigation-js for pathfinding

- **Status:** Accepted
- **Date:** 2026-09-16
- **Plan reference:** §2, E-3.1

## Context

Enemy and friendly AI need to path through levels, select cover positions, and
avoid each other locally. With six human slots plus roughly forty AI in a
session, pathing runs on the server every tick budget.

## Decision

`recast-navigation-js` — WASM bindings to Recast (navmesh generation) and Detour
(runtime queries). Navmeshes are baked offline in `packages/tools` as part of the
level pipeline, not generated at runtime.

## Consequences

- Recast is the industry-standard navmesh generator; baked output is predictable
  and inspectable, and bake time does not affect the runtime budget.
- Detour gives us corridor-based path following and off-mesh links (ladders,
  vaults, drops) without inventing them.
- Adds a second WASM module alongside Rapier. Both must initialize before the
  simulation can step, which the async init in T-0.10 must account for.
- Navmesh generation becomes a build step. Changing level geometry requires a
  re-bake, so the level pipeline (E-4.3) and the navmesh bake must be wired
  together or they will silently drift.

## Alternatives rejected

- **Waypoint graph.** Cheaper to build and query. Rejected: cover selection and
  local avoidance both want a surface, not a graph. Waypoints produce AI that
  visibly moves on rails, which is exactly the failure mode R3 warns about.
- **Hand-rolled navmesh generation.** Rejected: large, well-solved, and not where
  this project's novelty lies.
- **Runtime navmesh generation.** Rejected: unnecessary given static geometry
  (ADR-002 excludes destructibles), and it would consume server budget every
  session for a result that never changes.

## Addendum — 2026-09-22: the spike (T-3.01), measured

The decision stands. T-3.01 was the spike this ADR rests on — does Recast's
WASM run everywhere a session runs, and at what cost — and it does.

**Packages, pinned exact** (as ADR-005's addendum pinned Rapier):

| Package | Version | Where | Why |
|---|---|---|---|
| `@recast-navigation/core` | 0.43.1 | `server` (runtime), `tools` | Detour: load bytes, query |
| `@recast-navigation/generators` | 0.43.1 | `tools` only | Recast: bake a soup |

The umbrella `recast-navigation` package is deliberately not used: it would
put the generators — the bake — into the server's runtime dependencies, which
this ADR says never runs there. Both packages pull `@recast-navigation/wasm`
0.43.1, whose default entry is the "compat" build with the WASM inline as
base64: one import that works in Node and in every browser, no second file to
serve and no bundler plugin. It costs the page one extra chunk, loaded with it, of
**726 kB (220 kB gzip)**, on top of today's 760 kB main chunk.

**Where it must run.** Not only on the host: `LocalServer` builds a real
`Session` in the page, so Recast has to initialise in Chromium, Firefox and
WebKit too. It does. `SessionHost.start` awaits `initNav()` before it
listens; in the page, `LocalServer.create` awaits it, and the constructor
throws if called before it resolves, so a page cannot build a session whose
navmesh is not ready. The main page starts the init at load, so by the time
someone clicks "Practise here" it has usually long finished.

**One set of bytes, every runtime.** `pnpm gen:nav-spike` bakes a hand-built
soup in Node — a 40 m floor, a 2.4 m wall across it with a gap at one end, two
crates — and commits Detour's export (37,528 bytes) as
`server/src/ai/nav/spikeMesh.ts`, with the Node path length beside it. The
same test file, `NavMesh.test.ts`, loads those bytes and paths the 47.02 m
route round the wall in Node (default config) and in the three browsers
(`vitest.browser.config.ts`'s `nav-browsers` project, run by CI's browser
job). Re-baking in Node reproduces the committed bytes exactly
(`tools/src/nav/bake.test.ts`).

| Runtime | WASM init | Load 37 kB mesh | Path length divergence vs Node | µs per path (in-test, cold) |
|---|---|---|---|---|
| Node 22 (V8) | 45–61 ms | 2.9 ms | 0 m | 75 |
| Chromium (V8) | 106 ms | 4.8 ms | 0 m | 136 |
| Firefox (SpiderMonkey) | 102 ms | 1.0 ms | 0 m | 82 |
| WebKit (JavaScriptCore) | 224 ms | 9.0 ms | 0 m | 232 |

Node is this machine; the three browsers are one CI run (`parity-non-v8`
job, run 529, a GitHub `ubuntu-latest` runner), all from the same log. The
in-test µs figure is 500 queries straight after load, JIT still cold, and
browser timers are coarsened — read it as an order of magnitude; the warm
Node figure is below. WebKit's is the slowest by 2–3× and is still a quarter
of a millisecond. Only the in-page session pays browser costs; the host is
Node.

The bound asserted is 1 cm (§2.3: AI is not parity-critical, so this is a
sanity bound, not a gate). Detour's arithmetic is integer and float32 inside
the WASM, which every engine runs identically; unlike `Math.sin` (ADR-014)
there is no engine-supplied transcendental in the path, which is why the
measured divergence is zero rather than merely small.

**Cost, `pnpm bench:nav`** (Node 22, best of 5 × 5000 warm queries):

| | |
|---|---|
| WASM init | 61 ms, once per runtime |
| Bake, spike soup (floor + 3 boxes) | 86 ms |
| Path, 47 m round the wall (corridor + straight path) | 28.6 µs |
| Nearest point on mesh | 2.1 µs |
| Mesh raycast | 3.2 µs |

Against §7.9's proposed AI budget (≤ 25 % of the 33.3 ms tick, 8.3 ms), a
full repath for all 45 agents in one tick would be ~1.3 ms. Path following
will repath on a stuck detector, not every tick (T-3.05), so the real figure
is a small fraction of that.

**What this does not establish.** Bake time for a real world (T-3.03 bakes
the range's boxes), crowd cost (T-3.06 measures 45 agents), and off-mesh
links (T-3.04). The spike's agent parameters are typed in by hand in
`tools/src/nav/bake.ts`; T-3.03 derives them from `MoveConfig`.

**Crowd cost (T-3.06).** Local avoidance uses Detour's crowd for velocities
only — positions are written in from each `MoveState` every tick and the
crowd never moves a soldier. With 45 agents in two ranks crossing head-on on
open ground, one crowd update (placement, avoidance, read-back) costs about
0.4 ms mean and 1.2–1.4 ms worst in Node, ~1.2 % of the tick: well inside
§7.9's proposed 8.3 ms. Detour has no right of way, so a data-set patience
rule (`avoidance.json`) breaks the deadlock two soldiers meet in a one-wide
doorway.
