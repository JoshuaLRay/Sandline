# Sandline — context transfer: T-3.05 path following

> **Superseded 2026-09-22, the same day.** T-3.05 is built; `PLAN.md`'s
> T-3.05 entry (its Completed note) is authoritative and says what was done.
> Of the suggestions below, three went another way: the tuning is
> `server/src/ai/locomotion/follow.json` (server-only data, so not in
> `shared`); one 60 m route from slot 0 both vaults the low wall and goes
> through the west doorway, so no separate low-wall test was needed; and
> there is no vault approach tolerance to tune, because the follower presses
> jump only when a trial `stepCharacter` step with jump held starts the vault.

As of 2026-09-22, `main` at `2ba94f3`.

## Where things stand

E-3.1, the navmesh pipeline, is finished: T-3.01 to T-3.04 are all merged, and `main` is green at 869 tests. The next build task is **T-3.05, path following as input**.

| PR | Task | What it landed | Merge commit |
| --- | --- | --- | --- |
| #66 | T-3.04 | Vault links in the bake; `NavPath.vaults` | `2ba94f3` |
| #65 | T-3.03 | Range navmesh baked and committed, staleness hash, `pnpm gen:nav` | `ef600fe` |
| #64 | T-3.02 | Named worlds (`WORLD=range`), world id in `JoinAck` | `f05ed6c` |
| #63 | T-3.01 | Recast in Node + Chromium/Firefox/WebKit; T-2.43 run sheet | `e309ca9` |

- **Repo:** `joshualray/sandline`. Work happens on `claude/t243-u9cto8`, restarted from `main` after each merge. The name is historical; it is not tied to T-2.43.
- **Protocol version:** 16. `JoinAck` carries `world`, and `DISCONNECT_CODES` ends with `'unknown world'`.
- **Dependencies:** `@recast-navigation/core` 0.43.1 in `server` and `tools`; `@recast-navigation/generators` 0.43.1 in `tools` only. Both are pinned exact, and ADR-006's addendum records them with measured costs.
- **Fresh containers:** run `pnpm install --frozen-lockfile` before `pnpm verify`, or typecheck fails on missing `console`/`process` types.

## The next task: T-3.05, path following as input

T-3.05 turns a navmesh path into the same `MoveInput` a human sends, so a bot slot walks, and vaults, through `stepCharacter` exactly as a person does. Its spec is in PLAN.md §7.9 (search `#### T-3.05`); read that section and the §7.9 preamble, nothing else in PLAN.md.

- **Depends:** T-3.04 (done, merged in #66).
- **Files:** `packages/server/src/ai/locomotion/followPath.ts`, `packages/server/src/ai/nav/NavMesh.ts`, tests.
- **Do:** a pure function from (corridor, current `MoveState`, intent) to a `MoveInput`: yaw toward the next corner, move axes, walk/sprint/crouch from the intent, and forward intent into a vault link. It is stepped at 30 Hz and its output goes through `stepCharacter` like a human's input. Arrival radius, corner smoothing, and repath on a stuck detector (no progress along the corridor for N ticks) are data.
- **Done when:** a headless session test drives a bot slot from spawn to a goal 60 m away and it arrives inside the arrival radius within a bounded number of ticks; it crosses the low wall by vaulting; a bot pushed off its corridor (teleported sideways) repaths and still arrives; a goal off the mesh resolves to the nearest point on it; and the bot's server position matches a replay of its inputs through `stepCharacter` exactly.
- **Size:** M.

**The §7.9 rules that bind it:**

1. **The AI plays by the player's rules.** A brain produces a `MoveInput`; `stepCharacter` moves it. No second movement model and no teleporting along the path.
2. **Server-only, replicated, never predicted.** Randomness comes from the seeded PRNG (tick + netId), and nothing reads a clock.
3. **Behaviour at 10 Hz, locomotion at 30 Hz** (ADR-012). Path following is the 30 Hz half.
4. **Data over code.** Arrival radius, smoothing and the stuck-detector N go in JSON validated at import, like `weapons.json`.
5. **Measured before judged.** Ship the seeded headless scenario that reports ticks-to-arrive, and assert a floor.

## What T-3.05 builds on

Everything T-3.05 needs already exists: a committed, vault-linked range mesh, a small query API, and bot slots the session steps with whatever input they hold.

**Navmesh runtime (`packages/server/src/ai/nav/`)**

| Call | Returns | Notes |
| --- | --- | --- |
| `await initNav()` | — | Idempotent. The host and `LocalServer.create` already await it before any tick. |
| `loadWorldNavMesh(worldId)` (`bakedNav.ts`) | `NavMesh` | Loads the committed bake. Kept out of `NavMesh.ts` so the page doesn't bundle 246 kB of base64. |
| `mesh.nearestPoint(p)` | `{ point, polyRef }` or null | Query box is ±0.5 m across and ±2 m vertically. |
| `mesh.path(from, to)` | `{ corridor, points, vaults }` or null | Snaps both ends to the mesh. A partial corridor stops at the nearest reachable point, not the goal. |
| `path.vaults` | indices into `points` | The leg `points[i]` → `points[i+1]` is a vault link. |
| `mesh.raycast(from, to)` | `{ hit, t, point }` or null | Walks along the mesh surface. |
| `mesh.links()` | `{ from, to, vault }[]` | Every baked off-mesh link. |

**The range bake.** 169.9 kB with 6 vault links, all across the low wall (x −12..−6, z −1.15..−0.85), three each way, at x ≈ −11.65, −8.12 and −6.35. Each link starts 0.45 m off the near face and ends 1.5 m (`vaultDistance`) further along the facing. The mesh keeps 0.4 m from walls, because the 0.35 m radius rounds up to whole 0.1 m voxels.

**Moving a soldier.**

- `stepCharacter(state, input, TICK_SECONDS, moveConfig, world.boxes)` in `shared/src/sim/CharacterController.ts` is the only movement model.
- **Yaw** is a wire angle, 1024 per turn, and forward is `(sin yaw, cos yaw)`: yaw 0 faces +Z, 256 faces +X.
- **Vault trigger:** `jump` pressed, forward intent (`moveY > 0.5`, `|moveX| ≤ 0.5`), standing (not crouched or prone), not firing, on the ground, at a box the rule accepts. Walking into the wall without `jump` never vaults. Once started, a vault owns the tick for `vaultSeconds` (0.55 s).
- **Bot slots:** `Session.slots[i]` has `isBot`, `state`, `input` and `yaw`. For a bot, the session steps `stepCharacter` with `slot.input` every tick and never overwrites it, so setting `slot.input` before `session.step()` drives the bot.
- **Session world:** `session.world` (`{ id, boxes, floorHalfExtent }`); its `id` picks the bake.

**Test harness patterns to copy.** `server/src/session/namedWorld.test.ts` drives a session over a loopback wire; `fire.test.ts` has the keep-alive input pattern. `bot/src/harness.ts` runs a whole session in-process on a virtual clock.

## Suggested approach for T-3.05

Build a pure `followPath` step first and test it without a session; wire it to a bot slot only once it walks, vaults and repaths on its own. This is a suggestion, not a locked decision: the spec and the §7.9 rules are what bind.

1. **Data file.** `shared/src/data/locomotion.json` (or similar), validated at import: arrival radius, corner-cut distance, stuck ticks N, minimum progress per tick. §0.3 rule 4 forbids hard-coding them.
2. **Follower state.** Hold the current path, the index of the next corner, and a progress counter. The function stays pure: (state, `MoveState`, intent) → (next state, `MoveInput`, a repath request if any).
3. **Steering.** Yaw toward the next corner as a wire angle. `followPath` lives in `server`, so `Math.atan2` is allowed there; lint bans it only in `packages/shared`. Record the inputs so the replay test can re-run them.
4. **Vault legs.** When the next leg's index is in `path.vaults`, face along the link and hold `moveY = 1` with `jump` until `state.vault` is non-null. Then keep forward intent until the vault ends, and advance to the leg's far point.
5. **Stuck detector.** No progress along the corridor for N ticks → repath from the current position.
6. **Session wiring.** A test-only hook that sets a bot slot's `input` before each `session.step()` is enough; T-3.08 (brains on the session) owns the real integration.
7. **Tests** in the order of the spec's "Done when": 60 m arrival with a tick bound, the vault crossing, the teleport repath, a goal off the mesh, and the replay-equality check. Log ticks-to-arrive (rule 5).

**Open questions T-3.05 has to settle:**

- **Where is "60 m away"?** The range's far target is at z = 95; spawn is z = −6. A goal at (2.5, 0, 55) is about 61 m straight up the firing lane, but that lane has no obstacle. Pairing it with the separate low-wall test covers the vault.
- **Arrival radius vs mesh erosion.** A goal next to a wall snaps to 0.4 m off it; the arrival test should aim at the snapped point, not the requested one.
- **Vault approach tolerance.** `tryStartVault` refuses when `|moveX| > 0.5` or facing is off, so the follower must line up on the link's axis before pressing jump. How close is close enough is a new tuning value.
- **Replay exactness.** "Agree exactly" is satisfiable only if the test records the exact `MoveInput`s the follower produced, then replays them through `stepCharacter` with the same config and world.

## Gotchas from this session

Each of these cost time once; none is obvious from the code.

- **Editing a world, `MoveConfig` or the hitbox makes the bake stale.** `tools/src/nav/nav.test.ts` fails with "run pnpm gen:nav". Re-run it (about 6.5 s, two passes) and commit the regenerated `server/src/ai/nav/baked/*`. The hash covers the vault parameters too.
- **Generated files: arrays, not `+` chains.** A 2,300-term string concatenation overflowed ESLint's parser ("Maximum call stack size exceeded"). `gen-nav.ts` emits an array joined at load; keep it that way.
- **Detour flag lookups.** A connection's own `flags()` are its direction bits. The vault flag lives on the link's polygon: ref = `getPolyRefBase(tile) + con.poly()`. And `getPolyFlags` returns `{ status, flags }`, with no `success` field.
- **Two CI runs per PR.** A push runs CI, and opening the PR runs it again. The `parity-non-v8` job installs three browsers and takes about 70 s. Wait for both before merging.
- **Browsers in this container.** Only Chromium is installed, and it doesn't match Playwright 1.63's pin; don't run `playwright install`. Run the navmesh browser test with `CHROMIUM_PATH=/opt/pw-browsers/chromium npx vitest run --config vitest.browser.config.ts --project "nav-browsers (chromium)"`. CI covers Firefox and WebKit.
- **Fixture worlds.** `new Session(undefined, '', loadWorld({...}))` builds a session on any box list; `namedWorld.test.ts` shows it. A world with no `floor` gets its box extent plus 5 m.
- **The vault rule is looser than it looks.** From the 0.4 m slab, the controller will vault a 1.4 m post, and it will vault onto crate tops that the mesh doesn't reach. The bake drops links whose ends are off the mesh, so a bot never plans such a vault, but a human can make one.
- **Pronouns in comments.** Use they/them for soldiers and people in code comments and docs.

## Other open work

Besides T-3.05, two M3 build tasks are open, and five M2 human gates wait on the owner. An agent may prepare a gate's run sheet but must never write its verdict.

**Human gates (🧧), in TASKS.md's "Open now" block:**

| Gate | What | Run sheet |
| --- | --- | --- |
| T-2.24 | E-2.2 locomotion | `docs/playtests/e2-2.md`, prepared, not run |
| T-2.29 | E-2.3 animation layers | `e2-3.md` **missing**; an agent can write it |
| T-2.34 | E-2.5 projectiles | `e2-5.md` **missing**; an agent can write it |
| T-2.39 | Soldier's look | `soldier-look.md`, prepared, not run |
| T-2.43 | E-2.8 prone | `e2-8.md`, prepared this session, not run |

**Other unblocked M3 tasks:**

- **T-3.07, behaviour tree runtime.** No dependencies; lives in `shared`, so no `Math.random` or clocks.
- **T-3.18, cover points in the bake.** Depends only on T-3.04. It adds to `tools/src/nav/` and the committed bakes, so re-run `pnpm gen:nav`.

**Known issues:**

- **B-09** (`docs/BUGS.md`, open): crouched shots and all throws still leave from standing eye height.
- **`e2-2.md` is out of date:** it says walking into an obstacle starts a vault, but the controller now needs `jump` pressed.
- **E-2.7, combat audio:** still an unbroken epic, blocked on the assets-sourcing decision (§9 Q2).

**The loop.** `/next-task` (`.claude/commands/next-task.md`): read TASKS.md, then one PLAN.md section, then its ADRs; implement; `pnpm verify`; add the CHANGELOG line and flip the TASKS row in the same commit.
