# Handoff — M1.5: two humans, one session

**Written 2026-09-18, after T-1.5.01 and T-1.5.02 landed.**

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
| T-1.5.03 — 🧍 LAN two-human gate | **open** | needs two people, nothing left to build |
| T-1.5.04 — join codes, typed rejections | **open** | protocol v5 → v6 |
| T-1.5.05 — room registry | **open** | one process, many sessions |
| T-1.5.06 — lobby | **open** | the thing this handoff is really about |
| T-1.5.07 — one deployed host | **open** | **hard dependency** of the goal above, see §4 |
| T-1.5.08 — 🧍 remote two-human gate | **open** | closes R2 |

Measured at the end of T-1.5.02, two bots × 600 ticks on localhost:

```
over a real socket   peak 0.0116 m,  0/614 corrections,  0 unmatched
in-process loopback  peak 0.0116 m,  0/599 corrections,  0 unmatched
```

They match to four decimals, both under the 2 cm correction threshold and under
the 13.5 mm quantization floor. Nothing in the netcode was depending on the
loopback pair. Re-run both after any netcode change; a **divergence between the
two numbers** is the signal, not either number alone.

---

## 3. Joining a server today

Until the lobby exists, this is the only way, and it is what T-1.5.03 will be
run with.

### Two windows on one machine

```bash
pnpm host                             # terminal 1 — logs "host ready", port 8080
pnpm --filter @sandline/client dev    # terminal 2 — serves localhost:5173
```

Open `http://localhost:5173/?host=ws://localhost:8080` in two browser windows.
Each HUD's top line should read `joined — slot 1 of 6` and `joined — slot 2 of 6`.

**There is nothing to coordinate.** The host process holds exactly one session,
so everyone who connects is in it. Room codes only start to matter at T-1.5.05,
when one process begins holding several.

### Two machines on a LAN

```bash
pnpm host
pnpm --filter @sandline/client dev -- --host   # without --host, vite binds localhost only
```

Vite then prints a `192.168.x.x` address. Both people open
`http://192.168.x.x:5173/?host=ws://192.168.x.x:8080` — the **host machine's**
address in both places, never `localhost`, which would point the second machine
at itself.

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
2. **Not from the published QA site.** It is https, and browsers refuse `ws://`
   from an https page. The client says so in a red banner rather than letting it
   look like a dead host, but the fix is T-1.5.07, not a workaround.
3. **Positions persist across joins.** A slot keeps whatever position its last
   occupant left it at (ADR-001's entity swap). Restart `pnpm host` to put
   everyone back on the spawn line. This repeatedly made two test clients appear
   25 m apart when they were expected to be adjacent.
4. **The movement panel is prediction-only on a remote host.** The host owns the
   authoritative `MoveConfig`; the client's copy only predicts. Tuning against a
   remote host mispredicts every tick. Tune on the in-page session.

---

## 4. What has to be true before the QA site can do it

The dependency chain, and the part that is easy to miss:

```
T-1.5.04 (join codes on the wire)
        ↓
T-1.5.05 (many rooms in one process)
        ↓
T-1.5.06 (lobby UI)  ──┐
                        ├──→ the goal in §1
T-1.5.07 (wss:// host) ─┘
```

**The lobby alone does not get there.** A perfect lobby on the published site
still cannot open a socket, because the page is https and any host without TLS
is `ws://`. T-1.5.07 is not a follow-on polish task; it is half the goal.

Two consequences worth deciding early rather than discovering:

- **The build needs a default host.** The lobby should not ask a playtester for
  an address. Bake the deployed host into the build (T-1.5.07 says so), and let
  the UI override it for a LAN or a local process.
- **A public host is a public attack surface** with no accounts and a cost meter
  running — R12 in the risk register, arriving ~30 weeks earlier than the plan
  assumed. Room codes, connection caps, one small instance, and take it down
  between playtests. Real authentication is E-4.6 and nothing before it should
  pretend otherwise.

---

## 5. The remaining tasks

`PLAN.md` §6A has the full specs. This is what has been learned since.

### T-1.5.03 — 🧍 LAN two-human gate

Nothing left to build. Two people, two machines, one host, per §3.

**Recommendation: run this before building the lobby.** The gate judges *feel*
under lag — two players contesting a doorway, trading shots inside the same
rewind window, whether "I shot first" resolves in a way both people accept. How
you joined is irrelevant to that verdict, and a bad verdict sends the project
back to ADR-012 and changes what is worth building next. It is one sitting;
the lobby is three tasks.

Write the verdict into `docs/playtests/m1.5-lan.md`. State what a LAN leaves
unproven: NAT, internet jitter distributions, routing, and any latency a slider
did not put there.

> Note: `docs/playtests/` does not exist yet, and neither does `m1.md` — **M1's
> own gate T-1.24 has not been written down.** A gate whose result lives only in
> a conversation is not a gate (`PLAN.md` §10).

### T-1.5.04 — join codes and typed rejections

Protocol v5 → v6. `Join` carries a room code, `JoinAck` carries the room, and
the handshake's single free-text reason becomes a typed rejection.

The reasons matter more than they look. `NetClient` **discarded the `Disconnect`
message entirely** until T-1.5.02 — harmless on a loopback pair where the only
sender was the same page, and the difference between "the session is full",
"the host went away" and "your build is too old" on a real socket. Three
situations, three different responses, identical from a frozen screen. It now
surfaces them; keep it that way.

Generate codes from an alphabet without visually confusable characters. They get
read aloud over voice.

### T-1.5.05 — room registry

One process, many sessions. The reclaim policy is the judgement call: a bot-only
session still costs a full 30 Hz tick loop and should not outlive the people in
it, but reclaiming the instant someone's wifi drops loses their game.

`packages/server/src/session/` is already named "room, tick loop, player slots"
in `PLAN.md` §3. This is the room half, which has never existed.

### T-1.5.06 — lobby

See the amendment under the task in `PLAN.md` §6A. The short version: the lobby
owns the host address as well as the room code, and `?host=` pre-fills it rather
than bypassing it — two entry points means only one of them gets tested.

The roster is **six rows, always**, human or bot per row. A lobby that shows
"2 players" teaches everyone the wrong model of the game, and ADR-001 is the
whole thesis being demonstrated.

Out of scope and staying that way: matchmaking, parties, region selection,
ready-checks, class selection. E-4.5 and E-4.7.

### T-1.5.07 — one deployed host

One region, one process, no orchestration. **TLS is the task**, not a detail —
see §4.

`docs/DEPLOYING.md` must document teardown as well as deploy (R12).

### T-1.5.08 — 🧍 remote two-human gate

The verdict T-1.5.03 gives at LAN, repeated across the internet with
conditioning off. Record measured RTT, jitter and loss from the netgraph beside
each judgement, so it can be read against the NetSim cells T-1.22 asserts in CI.
Where they disagree, **the real link is right and the model needs revisiting**.

Carries the same stop rule as T-1.24: if it fails, go back to ADR-012 before M2
continues. R2 closes here.

---

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

### A stale build artifact, not yet cleaned up

`packages/server/src/session/Session.d.ts` and its `.d.ts.map` are committed
build artifacts describing a long-obsolete `Session` (no weapons, no health).
They are inert today because the package exports resolve to the `.ts`, but a
stale `.d.ts` beside its source is a trap. Deleting them is a two-line change
nobody has owned yet.

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
  Worth promoting to `packages/tools/` if T-1.5.06 needs it again.

Headless rendering in a container runs at 8–16 fps, which inflates measured RTT
(pings are processed on the frame loop). Do not read latency numbers off a
headless run; read them off a real browser.

---

## 7. Standing rules, unchanged

From `PLAN.md` §0.3, and they apply to every task above:

1. `pnpm verify` must pass. **387 tests** as of T-1.5.02.
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
