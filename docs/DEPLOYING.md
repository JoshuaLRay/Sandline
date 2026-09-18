# Running and publishing SANDLINE

## Run it on your own machine

Needs **Node 22+** and **pnpm 10+** (`npm i -g pnpm`).

```bash
git clone https://github.com/JoshuaLRay/Sandline.git
cd Sandline
pnpm install
pnpm --filter @sandline/client dev      # http://localhost:5173
```

The client is currently a **movement QA harness** and needs a keyboard:
WASD to move, Shift sprint, Ctrl crouch, Space jump, click to capture the mouse.

Also useful:

```bash
pnpm verify                                    # typecheck + lint + test
pnpm host                                      # authoritative session host
pnpm sim-run --scenario crowd --ticks 1800     # perf check, us/tick
pnpm bench:rapier                              # physics build comparison
pnpm bench:bandwidth                           # snapshot size vs ADR-012 budget
pnpm bench:tickrate                            # 30 vs 60Hz tick cost
```

## Run a host (T-1.5.01)

`pnpm host` serves the authoritative session over a real WebSocket - six slots,
bot backfill, the same `Session` the in-page harness runs. `PORT` selects the
port (default 8080).

Drive bots at it to check the netcode across a wire rather than a loopback pair:

```bash
pnpm host                                              # terminal one
pnpm bot --url ws://localhost:8080 --count 2 --ticks 600   # terminal two
```

The numbers should match `pnpm bot --count 2 --ticks 600` (no `--url`), which
runs the identical bots in-process on a virtual clock. A **difference** between
the two is the finding: nothing in the netcode is supposed to know which
transport it is on.

The host can also carry the harness's link sliders, so a playtest over a real
socket keeps the instrument the in-page one had. Latency applies **each way**,
so 100 ms is a ~200 ms round trip, matching what T-1.22's matrix calls 100 ms:

```bash
LINK_LATENCY_MS=100 LINK_JITTER_MS=20 LINK_LOSS=0.05 pnpm host
```

Loss is applied downstream only - see the note in `SessionHost.ts` for why the
server cannot honestly drop inbound traffic. Unset means a raw socket with no
decorator at all, which is what a deployed host runs.

### Two people, one session (T-1.5.02)

Open **http://localhost:5173/** in two windows. The lobby (T-1.5.06) is the
way in: one window clicks **Host a room** and reads the four-character code off
its squad panel; the other types it and clicks **Join**. Both squad panels then
show two humans and four bots, and the room code sits in the URL so a refresh
rejoins. The **Copy link** button gives the other player a URL with the code
already in it, which is the fast path when you are not on voice.

The lobby's host field is pre-filled from the build's default host (below) or
from `?host=`; `?room=` pre-fills the code. Neither parameter skips the lobby:
there is one way into a session, and it is the one that gets tested.

The HUD's top line is the connection: connecting, `joined - slot n of 6`,
`reconnecting - attempt 2 in 0.5s`, or `disconnected - <reason>`. The reason is
typed (T-1.5.04): "room full", "no such room", "this build is older than the
host", "the host is shutting down" are different sentences because they call
for different responses. A refusal drops you back into the lobby with the
sentence on screen.

Two things worth knowing:

- **The link sliders grey out.** Conditioning belongs to the host once the wire
  is real; the panel says so rather than moving a slider that reaches nothing.
- **`https` pages cannot open `ws://`.** The page names this rather than letting
  a browser-blocked socket look like a host that is down - the fastest way to
  spend an afternoon debugging a healthy server. It is why the published site
  needs the deployed host below and not a `pnpm host` on someone's laptop.

Rooms (T-1.5.05): one host process holds several, each its own session with
its own six slots and its own tick clock. A room with nobody in it is
reclaimed after `ROOM_GRACE_MS` (default two minutes - long enough for a
dropped player's reconnect backoff, short enough not to pay for an abandoned
room). `MAX_ROOMS` caps the process; a request for one more gets "host full".
`GET /healthz` on the host's port reports rooms, players and the protocol
version, and never lists codes.

## Publishing

The client is a static bundle - no server needed. The WASM is inlined into the
JS by the `-compat` Rapier build, so there is no separate `.wasm` to serve and
no MIME configuration to get wrong.

```bash
pnpm --filter @sandline/client build
# -> packages/client/dist/ - drag onto any static host
```

`.github/workflows/pages.yml` deploys this on every push to `main`.

**It needs turning on once:** repo -> Settings -> Pages -> Source ->
**GitHub Actions**. Not "Deploy from a branch" - that is the Jekyll path, and it
makes the Actions deploy fail with a misleading *"Ensure GitHub Pages has been
enabled"* 404 even though Pages is, technically, enabled.

Published at: **https://joshualray.github.io/Sandline/**

### One caveat that will matter later

**GitHub Pages cannot set custom HTTP headers**, so it cannot send the
`Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` pair that
`crossOriginIsolated` requires. Today that is harmless - the deterministic
Rapier build is single-threaded (ADR-005), so nothing needs isolation.

It stops being harmless if multithreaded WASM is ever wanted. The dev server
already sends those headers (T-0.06) specifically so the app never accidentally
depends on their absence. If that day comes, move to a host that supports custom
headers - Cloudflare Pages, Netlify and Vercel all do - rather than working
around Pages.

### Single-file build

`pnpm build:artifact` inlines everything into one `dist/artifact.html` that can
be opened from disk or pasted anywhere accepting a single HTML file.

## The deployed host (T-1.5.07)

The published page is https, so the host it joins must be **`wss://`**, and a
`wss://` host means a real deployment with TLS in front of it. This is half of
"join from the QA site", not a follow-on: without it the lobby on the published
page has nothing it is allowed to open.

The shape is E-4.9's first slice and nothing more - one container, one region,
no orchestration (ADR-011 addendum). It is a public address with no accounts in
front of it (R12), so: room codes are required to join, rooms and connections
are capped, the instance is the smallest there is, and it stops itself when
nobody is connected.

### What is in the repository

| File | What it is |
|---|---|
| `packages/server/Dockerfile` | the host as a container, built from the repo root; plain `ws://` on `PORT`, TLS expected outside |
| `fly.toml` | one Fly.io machine: TLS at the edge, auto-stop when idle, `/healthz` checked every 30 s |
| `.github/workflows/host.yml` | `flyctl deploy` on demand and on pushes to `main` that touch the host; skipped when no token is set |
| `.github/workflows/pages.yml` | bakes `SANDLINE_HOST` into the published client as the lobby's default |

Fly is the platform because it terminates TLS for free on `*.fly.dev`, proxies
WebSockets without configuration, stops an idle machine on its own, and has a
one-line teardown. Nothing here depends on it beyond `fly.toml`; any host that
runs a container and forwards a WebSocket over TLS works the same way with the
same image.

### First deploy, once

Needs [`flyctl`](https://fly.io/docs/flyctl/install/) and a Fly account.

```bash
fly auth login
fly launch --no-deploy --copy-config --name sandline-host   # or edit `app` in fly.toml
fly deploy --ha=false                                        # one machine, not two
fly status                                                   # hostname: sandline-host.fly.dev
curl https://sandline-host.fly.dev/healthz                   # {"ok":true,"protocol":6,"rooms":0,...}
```

Then point the published client at it:

1. Repo -> Settings -> Secrets and variables -> Actions -> **Variables** ->
   `SANDLINE_HOST` = `wss://sandline-host.fly.dev`. A variable, not a secret:
   it is baked into a public page.
2. Re-run the Pages workflow (or push to `main`). The lobby's host field now
   shows that address by default and the build stamp in the corner changes.
3. Open https://joshualray.github.io/Sandline/ in two browsers on two
   networks. Host, join, play. That is T-1.5.08's setup.

For the workflow to deploy on its own: `fly tokens create deploy -x 999999h`
and store it as the `FLY_API_TOKEN` repository **secret**. Without it the Host
workflow skips itself with a notice rather than failing.

### Redeploy

```bash
fly deploy --ha=false          # from a clean checkout of main
```

or Actions -> Host -> Run workflow. A push to `main` touching `packages/server`,
`packages/shared` or the Dockerfile deploys automatically once the secret is set.
The protocol version is in `/healthz`: if the published client is older than the
host, the lobby says "this build is older than the host - reload", and the fix
is to let Pages finish deploying.

### Watching it

```bash
fly logs                       # JSON lines from the host: seats, rooms reclaimed, drops
fly status                     # machine state - `stopped` between playtests is correct
curl https://sandline-host.fly.dev/healthz
```

Link conditioning works on the deployed host exactly as locally -
`fly secrets set LINK_LATENCY_MS=100` and a redeploy - but T-1.5.08 is run
with it **off**; the latency is whatever the internet gives, which is the point.

### Teardown (R12)

Between playtests the machine stops itself within a minute of the last socket
closing (`auto_stop_machines`, `min_machines_running = 0`) and starts on the
next connection, so the idle cost is a stopped machine's storage and nothing
else. When it should stay down:

```bash
fly scale count 0              # stops the machine and keeps it stopped
fly scale count 1              # bring it back for the next playtest
```

To remove it entirely - the app, its address and its certificate:

```bash
fly apps destroy sandline-host
```

Then clear the `SANDLINE_HOST` repository variable and re-run Pages, or the
published lobby will offer an address that no longer answers. (It fails
cleanly - "disconnected - gave up reconnecting" - but a default that lies is
worse than none.)

### If the browser says nothing at all

Open the console. `Mixed Content: The page at 'https://…' was loaded over HTTPS,
but attempted to connect to the insecure WebSocket endpoint 'ws://…'` means the
host address is `ws://` on an https page - the lobby refuses this before
connecting, so seeing it means the address was edited around the check. A
`wss://` address that times out with no console message is a host that is
stopped and not auto-starting, or a `fly.toml` whose `internal_port` does not
match `PORT`. `curl https://…/healthz` answers both.
