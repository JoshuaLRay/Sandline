# Running and publishing SANDLINE

## Run it on your own machine

Needs **Node 22+** and **pnpm 10+** (`npm i -g pnpm`).

```bash
git clone https://github.com/JoshuaLRay/Auto-GPT.git
cd Auto-GPT
git checkout claude/browser-conflict-desert-storm-8yq34l
cd sandline
pnpm install
pnpm --filter @sandline/client dev      # http://localhost:5173
```

Also useful:

```bash
pnpm verify                                    # typecheck + lint + test
pnpm exec tsx packages/server/src/main.ts      # headless authoritative server
pnpm sim-run --scenario crowd --ticks 1800     # perf check, µs/tick
pnpm bench:rapier                              # physics build comparison
```

## Publish it as a website

The client is a static bundle — no server needed. The WASM is inlined into the
JS by the `-compat` Rapier build, so there is no separate `.wasm` file to serve
and no MIME configuration to get wrong.

```bash
pnpm --filter @sandline/client build -- --base=./
# → packages/client/dist/ — drag this folder onto any static host
```

`.github/workflows/sandline-pages.yml` deploys this to GitHub Pages on every
push. **It needs turning on once:** repo → Settings → Pages → Source →
**GitHub Actions**. On a private repo, Pages requires a paid plan.

### One caveat that will matter later

**GitHub Pages cannot set custom HTTP headers**, so it cannot send the
`Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` pair that
`crossOriginIsolated` requires. Today that is harmless — the deterministic
Rapier build is single-threaded (ADR-005), so nothing needs isolation.

It stops being harmless if multithreaded WASM is ever wanted. The dev server
already sends those headers (T-0.06) specifically so the app never accidentally
depends on their absence. If that day comes, move to a host that supports custom
headers — Cloudflare Pages, Netlify and Vercel all do — rather than trying to
work around Pages.

### Single-file build

`pnpm build:artifact` inlines everything into one `dist/artifact.html` that can
be opened from disk or pasted anywhere that accepts a single HTML file.
