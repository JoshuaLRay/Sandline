# SANDLINE

Browser-based 6-player co-op squad shooter. See [`PLAN.md`](./PLAN.md) for the
full plan and task backlog, and [`docs/adr/`](./docs/adr/) for locked decisions.

**Current milestone: M2 — Shooter feel.** M1.5 is closed: T-1.5.03 and T-1.5.08
both passed, R2 is closed, and the authoritative host is deployed at
`wss://sandline-host.fly.dev`. See [`PLAN.md` §7](./PLAN.md) for the current M2
work and [`docs/HANDOFF-M1.5.md`](./docs/HANDOFF-M1.5.md) for the historical
M1.5 operational and debugging notes.
The PS2-era pass on the soldier is agreed and built as T-2.30 through T-2.33
(`PLAN.md` §7.5); its human gate T-2.34 is open, with the run sheet at
[`docs/playtests/soldier-look.md`](./docs/playtests/soldier-look.md).
[`docs/HANDOFF-SOLDIER-LOOK.md`](./docs/HANDOFF-SOLDIER-LOOK.md) is the context
transfer it came from, kept for its reasoning about the era and the fixed
points; where it and `PLAN.md` disagree, `PLAN.md` wins.

## Quick start

```bash
pnpm install
pnpm verify                 # typecheck + lint + test — the gate every task must pass
pnpm --filter @sandline/client dev    # renderer at localhost:5173
```

That opens the lobby. **Practise here** is the harness with a session running
inside the page - you and a sparring bot. For two people in one session you
also need a host:

```bash
pnpm host                   # authoritative session host on ws://localhost:8080
```

then open **http://localhost:5173/** in two windows, type `ws://localhost:8080`
into the host field, click **Host a room** in one and type its four-character
code into the other. Both squad panels show two humans and four bots. Set
`SANDLINE_HOST=ws://localhost:8080` before `pnpm --filter @sandline/client dev`
and the field is pre-filled.

The published site at https://joshualray.github.io/Sandline/ works against the
deployed host at `wss://sandline-host.fly.dev` (T-1.5.07). For local/LAN
operation, the host field can still be overridden; [`docs/DEPLOYING.md`](./docs/DEPLOYING.md)
has the deployment recipe, teardown, and the things that will waste your afternoon.

## Useful commands

| Command | What it does |
|---|---|
| `pnpm verify` | typecheck + lint + test |
| `pnpm host` | authoritative session host — six slots, real WebSocket (T-1.5.01) |
| `LINK_LATENCY_MS=100 LINK_JITTER_MS=20 LINK_LOSS=0.05 pnpm host` | same host with the link sliders applied on the wire — latency counts **each way** |
| `pnpm bot --count 2 --ticks 600` | netcode check in-process on a virtual clock (T-1.20) |
| `pnpm bot --url ws://localhost:8080 --count 2 --ticks 600` | the same bots over real sockets; the numbers should match the line above |
| `pnpm bot --url ws://localhost:8080 --room K7PM --count 1` | a bot into a room people are in (T-1.5.05) |
| `?host=ws://…&room=K7PM` | pre-fills the lobby; the squad panel's **Copy link** produces this (T-1.5.06) |
| `MAX_ROOMS=4 ROOM_GRACE_MS=60000 pnpm host` | rooms per process and how long an empty room lives (T-1.5.05) |
| `curl localhost:8080/healthz` | rooms, players, protocol version (T-1.5.07) |
| `pnpm sim-run --scenario crowd --ticks 1800` | headless simulation, reports µs/tick |
| `pnpm sim-run --scenario fall --ticks 1000 --parity` | two instances, reports divergence |
| `pnpm bench:rapier` | deterministic vs default vs SIMD physics cost |
| `pnpm gen:trig` | regenerate the committed trig table |
| `pnpm test:parity-browsers` | parity on Firefox + WebKit (needs `playwright install firefox webkit`) |

## Four things that will bite you

**Never call `Math.sin`/`cos`/`atan2`/`random` in `packages/shared`.** They are
not cross-engine deterministic. Lint blocks them. Use `shared/src/math`. The
server is Node (V8) and Chrome is V8, so violations are invisible in development
and only break Safari and Firefox players — see [ADR-014](./docs/adr/014-determinism-policy.md).

**Parity is bounded, not bit-exact.** Assert divergence under a threshold and log
the number. Exact equality is correct only on integer paths (tick counts, wire
round-trips, table lookups). Same ADR.

**An https page cannot open a `ws://` socket.** The published QA site is https,
so it needs `wss://` and therefore a real deployment (T-1.5.07). The browser
blocks the insecure socket in a way that looks exactly like the host being down,
which is the fastest known way to spend an afternoon debugging a healthy server.
The client names this case rather than letting you discover it.

**A slot keeps its position between occupants.** Joining swaps a bot for a human
on the same entity (ADR-001), so on a long-lived host you spawn wherever the
last person left. That is the design, not a bug — but restart `pnpm host` if you
want everyone back on the spawn line. Everything *per-client* resets on join;
getting that wrong cost a day (see the handoff doc).
