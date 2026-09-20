# Handoff — M1.5: two humans, one session (closed)

**Written 2026-09-18, after T-1.5.01 and T-1.5.02 landed. Updated the same day
after T-1.5.04 through T-1.5.07 landed — see §2 and §3, which changed most.**

For whoever picks this up next, agent or person. It covers two things: **how to
get two people into one session today**, and **what is left to build**, with the
things learned building the first two tasks that are not in `PLAN.md` because
nobody knew them when it was written.

`PLAN.md` §6A is the specification and stays authoritative. This document is
the state of play around it. Where they disagree, `PLAN.md` wins and this file
is stale — fix it.

---

## 1. The goal, stated plainly

> *"I want to do it all by joining a server in the UI on the QA testing site.
> Some way to join a room code maybe?"*

That is the acceptance bar for this milestone, and it is stricter than the
original T-1.5.06 wording. It means:

- Open **https://joshualray.github.io/Sandline/**
- Type or paste a room code
- Play, against another person

**No terminal. No query parameters. No hand-built URLs.** A playtester who has
to edit a URL is a playtester who runs the gate once, and only if they wrote it.

Everything that exists today — `pnpm host`, `?host=ws://…` — is developer
tooling. It is how the netcode gets tested and it should stay. It is not how
anyone joins a game.

---

## 2. Where things stand

| Task | State | What it gave us |
|---|---|---|
| T-1.5.01 — session host process | **done** | `pnpm host` serves the real `Session` over a WebSocket; `pnpm bot --url` drives bots at it |
| T-1.5.02 — client joins a remote host | **done** | `?host=ws://…` puts two browsers in one session |
| T-1.5.03 — 🧍 LAN two-human gate | **passed** | human sign-off recorded in `docs/playtests/m1.5-lan.md` |
| T-1.5.04 — join codes, typed rejections | **done** | protocol v6: room in `Join`/`JoinAck`, typed `Disconnect`, `Roster` |
| T-1.5.05 — room registry | **done** | one process, many sessions, each on its own clock; reclaim; caps; `/healthz` |
| T-1.5.06 — lobby | **done** | host / join / practise from the page; six-row squad panel; leave; share link |
| T-1.5.07 — one deployed host | **deployed** | live at `wss://sandline-host.fly.dev`; deployment and teardown remain in `docs/DEPLOYING.md` |
| T-1.5.08 — 🧍 remote two-human gate | **passed** | human sign-off recorded in `docs/playtests/m1.5.md`; R2 closed |

Measured at the end of T-1.5.02, two bots × 600 ticks on localhost:

```
over a real socket   peak 0.0116 m,  0/614 corrections,  0 unmatched
in-process loopback  peak 0.0116 m,  0/599 corrections,  0 unmatched
```

They match to four decimals, both under the 2 cm correction threshold and under
the 13.5 mm quantization floor. Nothing in the netcode was depending on the
loopback pair. Re-run both after any netcode change; a **divergence between the
two numbers** is the signal, not either number alone.

Re-measured after T-1.5.05 put the session behind a room registry: the same
`0.0116 m`, `0` corrections, `0` unmatched, both ways. Routing changed nothing
the netcode could feel. A headless browser driven through the lobby reconciles
at `0.008 m` while moving — near the floor, not zero (§6).

---

## 3. Joining a server today

Since T-1.5.06 the lobby is the only way in, and `?host=` only pre-fills it.

### Two windows on one machine

```bash
pnpm host                                                      # terminal 1 — logs "host ready", port 8080
SANDLINE_HOST=ws://localhost:8080 pnpm --filter @sandline/client dev   # terminal 2 — lobby pre-filled
```

Open `http://localhost:5173/` in two browser windows. In one, **Host a room**;
its squad panel shows a four-character code and the URL becomes `?room=XXXX`.
In the other, type the code and **Join** — or paste the link from **Copy
link**. Both squad panels read two humans and four bots; the HUD's top line
reads `joined — slot 1 of 6` and `joined — slot 2 of 6`.

Without `SANDLINE_HOST`, type `ws://localhost:8080` into the host field. Codes
are case-insensitive and ignore spaces and hyphens.

### Two machines on a LAN

```bash
pnpm host
SANDLINE_HOST=ws://192.168.x.x:8080 pnpm --filter @sandline/client dev -- --host
```

Vite prints a `192.168.x.x` address; both people open it. The host field must
carry the **host machine's** address, never `localhost`, which would point the
second machine at itself. `--host` is required or vite binds localhost only.

### The published site

Needs the deployed host from T-1.5.07 — an https page will not open `ws://`.
Once `SANDLINE_HOST` is set as a repository variable and Pages has rebuilt, the
lobby at https://joshualray.github.io/Sandline/ has the address filled in and
the flow is the same: host, read the code aloud, join.

### Rooms

One host process holds up to `MAX_ROOMS` (default 8, the Fly config says 4).
A room with nobody in it lives `ROOM_GRACE_MS` (default two minutes) and is
then reclaimed; a player whose connection drops and comes back inside that
window lands in the same room, because the client re-joins the code it was
given rather than asking for a new one. `curl localhost:8080/healthz` shows
rooms, players and the protocol version.

`pnpm bot --url ws://localhost:8080 --room XXXX --count 1 --ticks 600` puts a
bot into a room people are in, which is the cheapest way to see a moving
remote without a second human.

### Link conditions

Restart the host with them applied. Latency counts **each way**, so 100 is a
~200 ms round trip — matching what T-1.22's matrix calls 100 ms:

```bash
LINK_LATENCY_MS=100 LINK_JITTER_MS=20 LINK_LOSS=0.05 pnpm host
```

The in-page sliders grey out on a remote session and say why; conditioning now
lives on the host. Loss is applied downstream only — the server knows the
channel of what it sends but not of what it receives, since both channels map to
one TCP socket (ADR-008). `SessionHost.ts` has the full reasoning.

### Four things that waste time

1. **Both ports must be reachable.** 5173 serves the page, 8080 carries the
   game. A firewall allowing one and not the other gives you a page that loads
   and never joins — the HUD sits on `connecting...` and it looks like a netcode
   bug.
2. **Not from the published QA site without the deployed host.** It is https,
   and browsers refuse `ws://` from an https page. The lobby says so rather than
   letting it look like a dead host.
3. **Positions persist across joins.** A slot keeps whatever position its last
   occupant left it at (ADR-001's entity swap). Host a fresh room to put
   everyone back on the spawn line. This repeatedly made two test clients appear
   25 m apart when they were expected to be adjacent.
4. **The movement panel is prediction-only on a remote host.** The host owns the
   authoritative `MoveConfig`; the client's copy only predicts. Tuning against a
   remote host mispredicts every tick. Tune on the in-page session ("Practise
   here" in the lobby).

---

## 4. Deployed-host status

The M1.5 deployment gate is complete. The authoritative host is live at
`wss://sandline-host.fly.dev`, and the published QA site uses it. The deployment
recipe and teardown procedure remain in [`docs/DEPLOYING.md`](./DEPLOYING.md)
for future maintenance and playtests.

The public host remains intentionally minimal: room codes are required, room and
connection caps refuse excess load rather than degrade, and the Fly machine can
be stopped between playtests. Real authentication remains E-4.6; nothing in
M1.5 should be read as providing authentication.

For local development, `pnpm host` and the lobby's host override remain useful.
The debugging notes in §6 explain the failure modes discovered while building
this milestone.

---

## 5. M1.5 is closed; M2 is current

There are no remaining M1.5 build or human-gate tasks. The authoritative records
are:

- T-1.5.03 passed; see [`docs/playtests/m1.5-lan.md`](./playtests/m1.5-lan.md).
- T-1.5.08 passed; see [`docs/playtests/m1.5.md`](./playtests/m1.5.md).
- R2 is closed, as recorded in `PLAN.md` and the ADR-012 addendum.
- T-1.5.07 is deployed at `wss://sandline-host.fly.dev`.

The netgraph measurements requested by the original T-1.5.08 wording were not
recorded during the sign-off. They are useful follow-up telemetry for a future
two-person session, but they do **not** reopen M1.5 or block M2.

**Current work is M2 — Shooter feel.** Continue from `PLAN.md` §7. The M1.5
implementation and playtest notes below are retained as operational/debugging
reference rather than as an open-task checklist.

### Historical M1.5 task notes
## 6. Findings the next task needs

### The bug that will happen again in a different costume

`Session.assignSlot` let a joining client inherit the **previous occupant's**
`newestInputTick`. Tick numbers belong to a *client*, not a soldier — each
counts from its own page load — so the ordering guard in `applyInput` discarded
every input from the newcomer until their counter climbed past whatever the last
person reached.

It could not have appeared before T-1.5.01: every in-page session was built
fresh per page load, so a slot had never been reused by a different client. On a
long-lived host, every slot is.

The symptoms all pointed away from the cause:

- the player moves perfectly on their own screen and not at all on anyone else's
- they stand frozen at the previous occupant's position
- **prediction error reads exactly `0.000 m`** — because the server never
  acknowledged an input to reconcile against

That last number is the tell, and it generalises: *a prediction error of exactly
zero is not a good result, it is a dead reconciliation loop.* A healthy client
sits near the quantization floor (~0.008–0.012 m), never at zero.

The lesson for T-1.5.05: **entity state survives a slot swap, connection state
must not.** Position, health and weapon are deliberately inherited — that is
ADR-001. Anything scoped to a client's own connection has to be cleared. Rooms
will create more of this state; check each new field against that line.

### Two ordering traps in the link conditioner

Both are written up in `SessionHost.ts`; repeated here because they cost real time.

- **Pump outbound before inbound.** Delivering an inbound packet runs the
  session synchronously and it *replies*, so with the other order every reply was
  stamped at the instant it was released and went out with its latency skipped.
  The handshake looked instant while only snapshots were genuinely delayed —
  a conditioner that under-reports is worse than none.
- **Flush the outbound queue on close.** `NetSim.close` discards it, and the last
  thing a closing session sends is the `Disconnect` explaining why. Dropping it
  turns a clean shutdown into a silent vanish, which a client's reconnect backoff
  then chases for six attempts.

### Rooms, and the clock trap that came with them

Each room runs on **its own simulation clock, from zero**. Lag compensation
rewinds by `nowMs - renderTimeMs`, and the client computes `renderTimeMs` from
the ticks it has seen (`tick x 33.3 ms`). A room created ten minutes into the
host's life and stepped on the host's clock would have every shot ask for a
ten-minute rewind, clamped to 200 ms, resolving against the oldest history
there is — accurate-looking, and wrong for every player in every room but the
first. `Registry.step` advances each room by exactly one tick of its own time;
`SessionHost.route` restarts a joining connection's heartbeat clock on the
room's time (`ServerConnection.resetClock`), or `now - lastHeard` goes negative
and the peer can never time out. Both are tested; both are easy to undo by
"simplifying" the clocks into one.

### The stale build artifact is gone

`packages/server/src/session/Session.d.ts` and its map were deleted in the
T-1.5.04–07 change. `.gitignore` already covered `dist/`; nothing regenerates
them beside the source.

### Verifying without a second human

Two browsers can be driven headlessly, and it is worth it — this is how the
slot-reuse bug was found. Chromium is pre-installed at `/opt/pw-browsers/chromium`.

What the first attempts got wrong, so you do not repeat them:

- **`page.mouse.move(x, y)` is absolute, not a delta.** Repeated calls produce
  `movementX: 0` and the camera never turns. 365 shots at a target 1.5 m away,
  all missing, and nothing wrong with the game. Synthesize the delta instead:
  `dispatchEvent(new MouseEvent('mousemove', { movementX: n }))`. Pointer lock
  itself is real and works — click the canvas first and check
  `document.pointerLockElement`.
- **Set an explicit viewport** (`{ width: 1024, height: 700 }`). A click at
  coordinates that miss the canvas silently does nothing.
- **Keys need no pointer lock** (the listener is on `window`); mouse buttons do.
- **Read the HUD, not the scene.** `#stats` carries connection state, slot, netId,
  health, RTT, corrections and peak divergence — everything needed, and it tests
  the HUD at the same time.
- **An observer client is the ground truth.** Connect a `BotClient` over a plain
  socket and read `observer.store.current.entities` — that is the authoritative
  world every browser is subscribed to, so "did B actually move / take damage"
  is answerable without trusting either browser's rendering. Roughly 20 lines.
  Worth promoting to `packages/tools/` if it is needed a third time.
- **The lobby is scriptable.** `#lobby input[maxlength="32"]` is the name,
  `input.lobby-code` the code, the buttons are found by text. After a join,
  `.squad-code b` holds the room code and `#panel-squad .squad-list li` the six
  rows. T-1.5.06 was verified this way: two pages host and join, a third is
  refused with the typed reason, one leaves and the other's row flips to bot.

Headless rendering in a container runs at 8–16 fps, which inflates measured RTT
(pings are processed on the frame loop). Do not read latency numbers off a
headless run; read them off a real browser.

---

## 7. Standing rules, unchanged

From `PLAN.md` §0.3, and they apply to every task above:

1. `pnpm verify` must pass. **473 tests** in the current green verification baseline.
2. Tests ship with the code. Netcode changes need a headless test.
3. No new runtime dependency without an ADR line. (T-1.5.01 added none —
   `pnpm bot --url` uses Node 22's own global `WebSocket`.)
4. Data over code: weapons, classes and archetypes are JSON validated by zod.
5. `shared` imports nothing platform-specific.
6. One line per task in `docs/CHANGELOG.md`.

And one earned the hard way in T-1.5.02: **a regression test that passes against
the bug is worse than no test.** The first version of the slot-reuse test passed
without the fix — it was riding the leftover input queue rather than the new
client's inputs. Always run a new regression test against the un-fixed code and
watch it fail.
