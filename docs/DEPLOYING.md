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

Point the client at the host with `?host=`:

```
http://localhost:5173/?host=ws://localhost:8080
```

Two browsers on that URL take two of the six slots and are in the same session:
they see each other move and can shoot each other. Without the parameter the
page builds its own session in the tab exactly as before, which is what the
published build still does - it has no host to point at until T-1.5.07.

The HUD's top line is the connection: connecting, `joined - slot n of 6`,
`reconnecting - attempt 2 in 0.5s`, or `disconnected - <reason the host gave>`.
On a real socket "nothing is happening" and "nothing is moving" are different
faults, so the state is stated rather than inferred from a still screen.

Two things worth knowing:

- **The link sliders grey out.** Conditioning belongs to the host once the wire
  is real; the panel says so rather than moving a slider that reaches nothing.
- **`https` pages cannot open `ws://`.** The page names this rather than letting
  a browser-blocked socket look like a host that is down - the fastest way to
  spend an afternoon debugging a healthy server.

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
