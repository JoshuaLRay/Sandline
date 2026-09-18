# SANDLINE

Browser-based 6-player co-op squad shooter. See [`PLAN.md`](./PLAN.md) for the
full plan and task backlog, and [`docs/adr/`](./docs/adr/) for locked decisions.

**Current milestone: M1.5 — two humans, one session.** M1 proved the netcode
against a simulated link and a bot. M1.5 puts a second person on the far end of
a real socket, which is the half M1 structurally could not reach. See
[`PLAN.md` §4.2](./PLAN.md) for why it moved ahead of M2, and
[`docs/HANDOFF-M1.5.md`](./docs/HANDOFF-M1.5.md) for where it stands and what
is left.

## Quick start

```bash
pnpm install
pnpm verify                 # typecheck + lint + test — the gate every task must pass
pnpm --filter @sandline/client dev    # renderer at localhost:5173
```

That gives you the QA harness with a session running inside the page. For two
people in one session, you also need a host:

```bash
pnpm host                   # authoritative session host on ws://localhost:8080
```

then open **`http://localhost:5173/?host=ws://localhost:8080`** in two windows.
Each HUD should read `joined — slot n of 6`.

`?host=` is a developer tool, not the destination. Joining from the page — a
room code typed into a lobby, no URL editing — is T-1.5.04 through T-1.5.06, and
reaching it from the published QA site needs the deployed host in T-1.5.07.
[`docs/DEPLOYING.md`](./docs/DEPLOYING.md) has the full two-machine recipe and
the things that will waste your afternoon.

## Useful commands

| Command | What it does |
|---|---|
| `pnpm verify` | typecheck + lint + test |
| `pnpm host` | authoritative session host — six slots, real WebSocket (T-1.5.01) |
| `LINK_LATENCY_MS=100 LINK_JITTER_MS=20 LINK_LOSS=0.05 pnpm host` | same host with the link sliders applied on the wire — latency counts **each way** |
| `pnpm bot --count 2 --ticks 600` | netcode check in-process on a virtual clock (T-1.20) |
| `pnpm bot --url ws://localhost:8080 --count 2 --ticks 600` | the same bots over real sockets; the numbers should match the line above |
| `?host=ws://localhost:8080` | client query parameter: join a host instead of the in-page session (T-1.5.02) |
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
