# Handoff — T-3.05, path following as input

**Written 2026-09-22 on `main` at `2ba94f3`, after T-3.04 closed E-3.1. Nothing
here is built.** This is a context transfer for whoever picks up T-3.05. It
covers the exact surfaces the task builds on, the numbers measured against
the committed range bake, the traps those measurements found, and a proposed
design with a test plan for each "Done when".

`PLAN.md` §7.9 (T-3.05, and the §7.9 preamble's five rules) is the
specification and stays authoritative. Nothing here is 🔒, and every
recommendation below can be overruled. Where this file and `PLAN.md`
disagree, `PLAN.md` wins and this file is stale. When T-3.05 lands, mark
this file superseded in its header, as the other two handoffs are.

**Reading order:** this file, then `PLAN.md` §7.9's preamble and the T-3.05
entry (lines ~1456–1588). No ADR needs reading end to end. The parts that
matter are quoted below: ADR-006's addendum (repath on a stuck detector, not
every tick), ADR-012 (behaviour 10 Hz, locomotion 30 Hz) and ADR-014 via §2.3
(AI is not predicted, so it may diverge across engines).

---

## 1. The task, restated as five tests

| Done when (PLAN.md) | What actually has to be shown |
|---|---|
| Bot slot, spawn → goal 60 m away, arrives inside the arrival radius within a bounded number of ticks | A `Session` test, one bot slot driven tick by tick, with a tick bound computed from path length and speed, not a magic number. Log the actual tick count (§7.9 rule 5). |
| It crosses the low wall by vaulting | The same run can do it (see §3's route). Assert a vault actually started (`state.vault` non-null on some tick) and that no ordinary jump happened. |
| Pushed off its corridor (teleported sideways), repaths and still arrives | Assert **at least one repath happened**. Most teleports on the range recover without one (§3.3), so a test that only checks arrival can pass vacuously. |
| A goal off the mesh resolves to the nearest point on it | Today's `nearestPoint` returns a *near* point, not the nearest, and returns nothing past 0.5 m across or 2 m vertically (§3.4). This is the `NavMesh.ts` change. |
| Server position equals a replay of its inputs through `stepCharacter` | Record the start state and a **copy** of every tick's input, replay, and compare with `toEqual`. Exact equality is right here: `PLAN.md` asks for it, and this is the same function on the same inputs in the same runtime. ADR-014's bounded-divergence rule applies to cross-engine comparisons, which this isn't. |

Files per `PLAN.md`: `packages/server/src/ai/locomotion/followPath.ts`,
`packages/server/src/ai/nav/NavMesh.ts`, tests. §4.4 proposes one more file,
a JSON tuning file. Name it in the Completed note, as T-3.02 and T-3.03 did
for theirs.

---

## 2. What you are building on (exact surfaces)

### 2.1 The navmesh: `server/src/ai/nav/NavMesh.ts`, `bakedNav.ts`

- `await initNav()` must run before `NavMesh.load`. In tests, put it in
  `beforeAll`. `loadWorldNavMesh('range')` returns the committed bake.
- `mesh.path(from, to)` returns `{ corridor, points, vaults }` or null.
  `points` is the string-pulled path: start, each corner, end. `vaults` holds
  indices *i* where the leg `points[i] → points[i+1]` is a vault link. On a
  partial corridor (goal unreachable), the last point is the corridor's end,
  not the goal (`NavMesh.ts:129`). Treat `points.at(-1)` as the destination.
- Path points sit **~0.05 m above the feet** (a voxel). Measure every
  distance in XZ. A feet-vs-point 3D distance never goes below 5 cm.
- `QUERY_HALF_EXTENTS` is 0.5 × 2 × 0.5 m (`NavMesh.ts:82`). It is used for
  both ends of every path.
- **Keep `followPath.ts` from importing `bakedNav.ts`.** That module pulls
  every world's base64 bake into whatever imports it. `bakedNav.ts` keeps it
  out of the page on purpose, and T-3.08 will import the follower from
  `Session`. Take a `NavMesh` (or a `NavPath`) as a parameter instead.
- The `nav-browsers` vitest project runs `src/ai/nav/**/*.test.ts` in
  Chromium, Firefox and WebKit. New `NavMesh` tests there run in all three,
  which is good for the goal-resolution change. Put follower and session
  tests under `src/ai/locomotion/` so they stay Node-only.

### 2.2 The controller: `shared/src/sim/CharacterController.ts`

- `MoveInput.yaw` is a **wire angle: an integer, 1/1024 turn** (10 bits on
  the wire). Forward is `(sin, cos)` of it, so **yaw 0 = +Z, 256 = +X, 512 =
  −Z, 768 = −X**. `wireToTable` shifts (`wire << 2`), so a fractional yaw is
  truncated without any error. Round it yourself:
  `((Math.round(Math.atan2(dx, dz) / (2π) * 1024) % 1024) + 1024) % 1024`.
  `Math.atan2` is fine in `server/` (the lint ban covers only
  `packages/shared`), and AI is not predicted (§7.9 rule 2).
- **No acceleration.** Horizontal velocity is axis × speed, applied that
  tick. So the final approach can scale `moveY` to land exactly instead of
  overshooting by up to 0.23 m, which is one sprint tick (6.8 m/s ÷ 30).
- Speeds: walk 4.2, sprint 6.8, crouch 1.9, prone 1.1 m/s. AI going prone is
  out of scope for M3 (§7.9 "Not in this milestone").
- **The vault's preconditions** (`:246–260`): grounded, not downed,
  **standing**, `jump`, not `firing`, `moveY > 0.5`, `|moveX| ≤ 0.5`, and
  then `tryStartVault`. "Standing" uses the *provisional* stance, which is
  the higher of current and desired. So a crouched soldier who releases
  crouch and presses jump on the same tick **cannot vault that tick**. See
  §3.5 for the consequence.
- **Jump with nothing to vault is an ordinary jump** (`:319`, 6 m/s up).
  Pressing jump at the wrong moment makes the bot hop in front of the wall,
  and a hop can't start a vault until it lands.
- A vault owns the tick while it runs (`state.vault` non-null), ignores the
  input, and lands **1.5 m along the facing from wherever it started**. It
  does not land at the link's `to` point. It takes 0.55 s (~17 ticks).

### 2.3 The session: `server/src/session/Session.ts`

- A bot slot is stepped with **whatever `slot.input` holds**, untouched,
  every tick (`:1023`). It is reset to idle only on leave, bleed-out and
  respawn. `slots` is public. **So a test drives a bot by writing
  `session.slots[k].input = …` before each `session.step(now)`**, with `now`
  advancing by `1000 / 30`. T-3.05 needs no `Session` API. Wiring a brain
  and follower into `step` is T-3.08's job; don't pre-empt it.
- `step` **mutates `slot.input.downed` in place**. Return a fresh object
  every tick, and record `{ ...slot.input }` for the replay. Recording the
  reference gives you N pointers to one object.
- Replay with `stepCharacter(s, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG,
  session.world.boxes)`. The session's config defaults to that same object
  reference, and the bake was made from it.
- Spawn: slot *k* stands at `SPAWN_POINTS[k]`: x = −3.75 … 3.75 in 1.5 m
  steps, z = −6, all facing yaw 0.

### 2.4 The range, in the numbers that matter here

| Thing | Extent |
|---|---|
| Low wall (vaultable, 1.0 m) | x −12..−6, z −1.15..−0.85 |
| West wall a / b (2.4 m) | x −14..−9 / −7.8..−4.2, z 3.85..4.15 |
| West doorway | x −9..−7.8 at z = 4 |
| Crate-c (1.2 m) | x 6.4..7.6, z −3.6..−2.4 |
| Floor (walkable) | ±100 m |
| Vault links (6, all low wall) | x = −11.65, −8.12, −6.35; south→north `(x, −1.60) → (x, −0.10)`; north→south `(x, −0.40) → (x, −1.90)` |

Links are axis-aligned by construction (T-3.04), so a vault leg's yaw is
always 0, 256, 512 or 768.

---

## 3. Measured, not guessed

Every number here comes from throwaway probes run against the committed
range bake (`tsx`, Node 22), using a naive follower written only to test the
claims. That follower is not committed and is not the design. §5 says how to
reproduce the numbers.

### 3.1 One route covers "60 m" and "vaults"

**Slot 0 → (−33.75, 0, 45.96)**, which is 60 m from its spawn on a 330°
bearing. The path is 61.07 m in 6 points:

```
0 (-3.75, -6.00)  spawn
1 (-8.12, -1.60)  vault link start   ← vaults = [1]
2 (-8.12, -0.10)  vault link end
3 (-8.50,  4.30)  west doorway
4 (-20.60, 19.70)
5 (-33.75, 45.96) goal
```

Slot 0 has to be the one: from slots 2 and 5 the same bearing does not vault.
From slot 0, every 60 m goal between bearings 305° and 350° vaults (sampled
every 5°). An
alternative with a round-number goal is (−40, 0, 40): 59.28 m, also vaulting
at x = −8.12.

### 3.2 A naive follower on that route

| | Walk | Sprint |
|---|---|---|
| Ticks to arrive | 441 | 280 |
| Ideal (length ÷ speed ÷ dt) | 436 | 269 |
| Vaults / stray hops | 1 / 0 | 1 / 0 |

The overhead is the vault (17 ticks covering 1.5 m). A bound of `ceil(1.1 ×
length / (speed × TICK_SECONDS)) + 20` holds with room to spare.

**Corner radius** (advancing to the next corner once within *r* of the
current one) costs nothing from 0.1 to 1.5 m: 441–444 ticks walking. At
**2.5 m it costs ~60 extra ticks**, because the cut corner at the doorway
puts the bot against west-wall-b and it slides. Start at 0.3.

### 3.3 The teleport trap: most teleports don't force a repath

The controller resolves X and Z separately, so walking into a wall at any
angle *slides* along it. On the range's short walls, the bot then usually
walks off the end and carries on. Most sideways teleports therefore recover
with no repath at all, and would pass the test without exercising it.

A trap that does force one: **goal (−11.5, 0, 20)**, north of west-wall-a's
centre. **At tick 150** (the bot is past the doorway), **teleport the bot to
(−11.5, 0, 2)**, due south of the wall's centre. The next corner is now due
north through the wall, so the bot walks straight into it and nothing makes
it slide.

| Stuck detector | Result |
|---|---|
| none | pinned at (−11.50, 3.50) forever |
| 5 / 10 / 15 / 30 ticks without progress | exactly 1 repath; arrives at tick 299 / 302 / 307 / 322 |

To teleport in a test, write `session.slots[k].state = createMoveState(x, 0, z)`.

### 3.4 Goal resolution: today's query is near, not nearest

`findClosestPoint` picks the nearest polygon *among those overlapping the
query box*, then the closest point on that polygon. With 0.5 m extents:

| Goal | 0.5 × 2 × 0.5 (today) | 2 × 4 × 2 | 64 × 8 × 64 |
|---|---|---|---|
| Crate-c centre (7, 0, −3) | (6.07, −3.70), **1.14 m away** | (7.00, −4.00), **1.00 m, the true nearest** | same |
| Past the floor (−3.75, 0, 150) | **null** | null | (−3.75, 99.50) |
| On west-wall-a (−11.5, 2.4, 4) | **null** | (−11.50, 3.40) | same |

A 64 m query costs 17 µs. That is fine at repath time, never per tick.
**Accept a hit only when its horizontal distance from the goal is within the
box's horizontal half-extent**, and its height within the vertical one.
Past that distance, a nearer polygon can sit just outside the box. That is
exactly what happens to the crate at 0.5 m: 1.14 m is farther than 0.5 m,
and the 1.00 m point is outside. If the hit fails the check, widen the box
(×4 up to a data-set maximum) and query again. With that rule the three rows
above resolve at 2, 64 and 2 m. Crate and block tops carry no mesh: they
erode away entirely, and the block on the slab resolves to the slab at
y ≈ 0.45. So on the range, the nearest point is always one a bot can reach.

### 3.5 Deciding when to press jump: ask the controller, not `tryStartVault`

At the −8.12 link start, a crouched soldier:

| Input | `tryStartVault` says | What `stepCharacter` actually does |
|---|---|---|
| crouch released + jump, same tick | vault | **ordinary jump** (vy = 6.0), because stance is still crouched this tick |
| standing + jump | vault | vault |
| standing + jump + firing | vault | **ordinary jump** |

`tryStartVault` answers only the geometry question, so using it as the
predicate still produces hops. T-3.04's rule was to find links by asking the
controller, not by restating its rule. The same rule applies here: on a vault
leg, **trial-step** `stepCharacter(state, { ...input, jump: true }, …)` and
press jump only if the trial's `vault` is non-null. This costs one extra
pure call per vaulting bot, only while it approaches a link. It also
releases crouch on its own: the release tick's trial says no, the bot stands
up, and the next tick's trial says yes.

### 3.6 A bug the probe hit: leave a vault leg on the vault's completion edge

The first version of the probe moved past the vault leg once the bot came
within 0.6 m of the link's `to` point. With a 1 m corner radius the bot
reached the leg 0.6 m east of the link, and the vault landed 1.5 m north of
*that* spot (§2.2), outside the 0.6 m radius. The leg never ended, so the
bot walked north into west-wall-b. **Advance past a vault leg on the tick
`state.vault` goes from non-null to null**, whatever the position. Separately,
count ticks spent on a vault leg without a vault starting as "no progress",
so a missed vault falls to the stuck detector.

---

## 4. Proposed design (overrule freely)

### 4.1 Shape: a pure step with state passed in and out

Stuck detection needs memory, so "a pure function from (corridor, state,
intent)" means passing a small follower state in and out. This is
`stepCharacter`'s own idiom: the vault's state lives inside `MoveState` so
the function stays pure.

```ts
// followPath.ts (sketch, not a spec)
export interface LocomotionIntent { goal: NavPoint; pace: 'walk' | 'sprint' | 'crouch' }
export interface FollowState {
  path: NavPath;          // from mesh.path(); replaced on repath
  leg: number;            // index of the point being walked to
  bestRemaining: number;  // XZ distance left along the path, best so far
  sinceProgress: number;  // ticks without beating bestRemaining by progressEpsilonM
  wasVaulting: boolean;   // for the completion edge (§3.6)
}
export type FollowStatus = 'following' | 'arrived' | 'stuck';

export function followPath(
  f: Readonly<FollowState>, state: Readonly<MoveState>, intent: Readonly<LocomotionIntent>,
  tuning: FollowConfig, move: MoveConfig, world: readonly WorldBox[],
): { input: MoveInput; follow: FollowState; status: FollowStatus };
```

A thin stateful wrapper in the same file (`PathFollower`) owns the `NavMesh`,
calls `mesh.path` on a new goal and on `'stuck'`, and **never repaths while
`state.vault` is set**: the start point would be mid-air over the wall. The
session test, and later T-3.08, talk to the wrapper. Detour is called only
at (re)path time, which is the cost ADR-006's addendum priced in.

### 4.2 Each tick, in order

1. **Vaulting** (`state.vault` set): return a forward input, which the
   controller ignores. Hold the stuck counter. On the completion edge, move
   past the vault leg.
2. **Advance corners**: move on once within `cornerRadiusM` *or* past the
   corner along its leg (a dot-product check, so a sprint tick's overshoot
   still counts). Never skip a vault start: the bot must stand at it.
3. **Vault leg**: yaw = the link's axis direction, `moveX` 0, `moveY` 1,
   crouch, prone and firing off, `jump` = §3.5's trial step.
4. **Ordinary leg**: yaw toward the next corner, `moveY` 1, sprint or crouch
   from `intent.pace`. On the final leg, scale `moveY` to `min(1, distance ÷
   (speed × dt))`. Don't scale on a vault leg: `moveY ≤ 0.5` refuses the vault.
5. **Arrived**: last point within `arrivalRadiusM` → idle input, same yaw,
   `'arrived'`, stuck detector off.
6. **Stuck**: remaining XZ distance along the path hasn't improved by
   `progressEpsilonM` in `stuckTicks` → `'stuck'`. Measure over the window,
   not per tick: prone speed is 0.037 m/tick, below a 5 cm epsilon.

Don't limit the turn rate or build spline smoothing. Yaw snaps per tick, the
same as a mouse. How it *reads* is for the 🧍 gates, and a corner radius is
the only smoothing `PLAN.md` asks for.

### 4.3 Intent

Keep it minimal, since T-3.07/T-3.08 will produce it: a goal and a pace. A
brain re-emits intent at 10 Hz. The wrapper should repath only when the goal
moves more than a small data-set distance, not on every re-emit.

### 4.4 "Are data": a JSON file, validated by hand

§0.3 rule 4 and §7.9 rule 4 want tuning in JSON validated at import. §0.3
rule 3 is why that validation is hand-written, not zod: see
`shared/src/sim/weapons.ts`'s "Hand-written rather than zod" block and copy
its pattern. The file is server-only data, so put it next to the follower,
e.g. `server/src/ai/locomotion/follow.json`. Server TS already resolves JSON
imports. Starting values the probe supports:

| Key | Start at | Why |
|---|---|---|
| `arrivalRadiusM` | 0.25 | A bit over one sprint tick; the scaled final step lands inside it anyway |
| `cornerRadiusM` | 0.3 | 0.1–1.5 all cost nothing; 2.5 costs 60 ticks (§3.2) |
| `stuckTicks` | 15 | 0.5 s; 5–30 all recover the trap with one repath |
| `progressEpsilonM` | 0.05 | Over the whole window, not per tick |
| `goalSearchMaxM` | 64 | Reaches a goal 50 m past the floor edge (§3.4) |
| `repathGoalMoveM` | 0.5 | §4.3 |

### 4.5 `NavMesh.ts`

Give `nearestPoint` an optional half-extents argument. Add a goal resolution
that widens the search per §3.4, and accepts a hit only when it is closer
than the box's half-extent. Use it for the `to` end of `path()` (the `from` end is a bot's
feet, which are always on the mesh). Test it in `NavMesh.test.ts` so it runs
in all three browsers.

---

## 5. Test plan

`packages/server/src/ai/locomotion/followPath.test.ts` (Node only):

- **Pure unit tests, no WASM:** a hand-built `NavPath` with a corner and a
  vault leg over a one-wall `loadWorld` fixture, checking corner advance,
  arrival returning idle, the vault leg's input (axis yaw, trial-step jump,
  crouch released), the completion edge, and `'stuck'` after `stuckTicks`.
- **Session: 60 m + vault.** Slot 0 → (−33.75, 0, 45.96), walking. Bound it
  as in §3.2, log the ticks, assert arrival inside `arrivalRadiusM`, assert
  that `state.vault` was set on some tick while x ∈ [−12, −6] and that no
  tick had `vy === jumpSpeed` outside a vault. Record start state and input
  copies from this run for the replay test.
- **Session: replay.** Replay the recorded run and `toEqual` the final
  `MoveState`, plus each tick's state if cheap. Keep the teleport out of
  this run, since a teleport is not an input.
- **Session: teleport.** §3.3's trap. Assert repaths ≥ 1, then arrival.
- **Session: off-mesh goal.** Crate-c centre (7, 0, −3). Assert the
  resolved point is 1.00 m (± a voxel) from the goal, and that the bot
  arrives within `arrivalRadiusM` of the *resolved* point. Optionally add
  (−3.75, 0, 150) → z ≈ 99.5.

**Reproducing §3:** a scratch `.mts` file (`.ts` fails on top-level await
under `tsx`) importing `NavMesh.ts`, `bakedNav.ts` and `shared/src/index.ts`
by absolute path. Run it from `packages/server` with `npx tsx <file>` so
`@recast-navigation/core` resolves.

---

## 6. Out of scope, and why

- **`Session.ts`**: brains and the 10 Hz / 30 Hz wiring are T-3.08's.
- **Avoidance**: T-3.06. Soldiers don't collide with each other, so
  multi-bot tests will overlap. Use one bot per test.
- **Detour's crowd**: T-3.06's, and only for avoidance velocities.
- **AI prone, turn-rate limits, animation**: excluded by §7.9, or left to
  the gates to judge.
- **Randomness and clocks**: the follower needs neither. If it seems to,
  something is wrong (§7.9 rule 2).

## 7. Closing the task

`pnpm verify` green. Walk the five "Done when" rows in §1. Add a CHANGELOG
line `T-3.05 — …`, and in the same commit flip `TASKS.md`: T-3.05 → DONE,
and T-3.06 → OPEN, since its only dependency is T-3.05. Write the `PLAN.md`
Completed note naming the JSON file. Mark this handoff superseded. Commit as
`T-3.05: path following as input`.
