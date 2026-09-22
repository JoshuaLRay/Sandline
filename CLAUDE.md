# Agent brief

## Routing — read this before opening anything else

| You need | Go to | Not |
|---|---|---|
| What's next / task status | `/TASKS.md` | — |
| A task's exact scope | The **one** `PLAN.md` section `TASKS.md` names for that task | Do not read `PLAN.md` end to end. It is a 1500-line historical record with 85 tasks' worth of completion notes; almost none of it is relevant to the task in front of you. |
| A locked decision (🔒 in the plan) | `docs/adr/` — one file per ADR | Do not re-litigate a 🔒 decision. If it looks wrong, stop and say so. |
| Why a *finished* task was built the way it was | The task's own entry in `PLAN.md` (its "Completed" note) and `docs/CHANGELOG.md` | These are reference, not a reading assignment — look up the one task you care about. |
| Historical context on M1.5 or the soldier-look pass | `docs/HANDOFF-M1.5.md`, `docs/HANDOFF-SOLDIER-LOOK.md` | **Superseded.** Don't read these unless a task explicitly points at one. Where they and `PLAN.md` disagree, `PLAN.md` wins. |

**The point of this file existing:** completing the next available task should
cost a few thousand tokens, not ~40k. `TASKS.md` → one `PLAN.md` section → the
ADRs that section names → implement. That's the whole loop. See
`/.claude/commands/next-task.md` for the exact procedure.

---

## Commands

| Command | What it does |
|---|---|
| `pnpm verify` | typecheck + lint + test — the gate every task must pass |
| `pnpm host` | authoritative session host — six slots, real WebSocket |
| `LINK_LATENCY_MS=100 LINK_JITTER_MS=20 LINK_LOSS=0.05 pnpm host` | same host with link sliders on the wire — latency counts **each way** |
| `pnpm --filter @sandline/client dev` | renderer dev server at localhost:5173 |
| `pnpm bot --count 2 --ticks 600` | netcode check in-process on a virtual clock |
| `pnpm bot --url ws://localhost:8080 --count 2 --ticks 600` | same bots over real sockets; numbers should match the line above |
| `pnpm bot --url ws://localhost:8080 --room K7PM --count 1` | a bot into a room people are in |
| `?host=ws://…&room=K7PM` | pre-fills the lobby |
| `MAX_ROOMS=4 ROOM_GRACE_MS=60000 pnpm host` | rooms per process and how long an empty room lives |
| `WORLD=range pnpm host` | the named world every room is built with (`data/worlds/*.json`; `range` is the default and, for now, the only one) |
| `curl localhost:8080/healthz` | rooms, players, protocol version |
| `pnpm sim-run --scenario crowd --ticks 1800` | headless simulation, reports µs/tick |
| `pnpm sim-run --scenario fall --ticks 1000 --parity` | two instances, reports divergence |
| `pnpm bench:rapier` | deterministic vs default vs SIMD physics cost |
| `pnpm bench:nav` | Recast init, bake and Detour query cost |
| `pnpm gen:trig` | regenerate the committed trig table |
| `pnpm test:parity-browsers` | parity on Firefox + WebKit (needs `playwright install firefox webkit`) |

---

## Standing rules for every task (PLAN.md §0.3)

1. **The repo stays green.** `pnpm verify` must pass before a task is done. No task lands red.
2. **Tests ship with the code.** New logic in `packages/shared` requires unit tests. Netcode changes require a headless integration test.
3. **No new runtime dependency** without a line in `docs/adr/`. Dev deps are free.
4. **Data over code.** Weapons, classes, enemy archetypes are JSON validated by zod schemas, never hardcoded in systems.
5. **`shared` imports nothing platform-specific.** No `three`, no `ws`, no `fs`. It must run headless in Node and in the browser. Where client and server must agree numerically, the bar is **bounded divergence, never bit-equality**.
6. **Leave a trail.** Each task appends a one-line entry to `docs/CHANGELOG.md`.
7. **Keep `TASKS.md` current.** The same commit that appends the CHANGELOG line also flips that task's row from OPEN to DONE (or BLOCKED/🧍).

---

## Four things that will bite you

**Never call `Math.sin`/`cos`/`atan2`/`random` in `packages/shared`.** They are
not cross-engine deterministic. Lint blocks them. Use `shared/src/math`. The
server is Node (V8) and Chrome is V8, so violations are invisible in
development and only break Safari and Firefox players — see
[ADR-014](./docs/adr/014-determinism-policy.md).

**Parity is bounded, not bit-exact.** Assert divergence under a threshold and
log the number. Exact equality is correct only on integer paths (tick counts,
wire round-trips, table lookups). Same ADR.

**An https page cannot open a `ws://` socket.** The published QA site is
https, so it needs `wss://` and therefore a real deployment. The browser
blocks the insecure socket in a way that looks exactly like the host being
down — the fastest known way to spend an afternoon debugging a healthy
server.

**A slot keeps its position between occupants.** Joining swaps a bot for a
human on the same entity (ADR-001), so on a long-lived host you spawn
wherever the last person left. That is the design, not a bug — but restart
`pnpm host` if you want everyone back on the spawn line.

---

## Also relevant

- `packages/shared/CLAUDE.md` — determinism constraints for that tree specifically; loads automatically when you touch it.
- `docs/DEPLOYING.md` — deployment recipe, teardown, and the things that will waste your afternoon.
- `docs/BUGS.md` — running list of reported gameplay bugs not yet scoped into a `PLAN.md` task.
- `README.md` — the human-facing overview. Prefer this file for agent work.
