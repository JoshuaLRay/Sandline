# U-179 — Fixed outpost furnishings

PR [#347](https://github.com/JoshuaLRay/Sandline/pull/347), first engineering leaf
of U-176. U-180 retains the V3 gun conflict and full tactical clearance matrix;
U-177 retains real captive/escort tank-shell, blast and seven-actor proofs.
Activation remains U-117; whole-mission human quality remains U-119.

## Constructed geometry

The isolated outpost includes all four §8.2 cover items at their original exact
coordinates, the 2×1×1 m radio table, eight folded visual gate leaves, radio
set/lamp/aerial lead and blue cell trim/paperwork. Dressing never enters collision.
The tower spans x46..52,z414..420 with four uninterrupted legs and closed tank
at y22..26; it has no ladder, deck, intermediate step or interaction.
Inherited rock originally rose to y34 over the specified tower. Only the bounded
x46..52,z412..420 volume above y8 is removed before restoring the exact north
wall. Adjacent rock remains; the footing pocket and tower top are isolated from
all three approaches and the reserve annex in actual standing navigation.

## Independent engineering evidence

- Ten exact collision fixtures and sixteen noncolliding cues; fixture dimensions
  are independently transcribed from the specification.
- Twenty-three full-width circulation/room landing rectangles measured against
  complete collision, with actual body and floor support samples.
- All six holding positions and the full x14..18,z396..400 cell landing remain
  supported and clear. Existing nav/controller rescue access remains required.
- 192 jump/crouch/prone controller attempts, 34,560 ticks, include every prop top
  and otherwise inaccessible tower-footing starts. Peak feet y11.22; no grounded
  structural roof, perimeter, tank or terrain shortcut reached.
- The supported court capture at (36,8,385) has a real first-hit ray to the tank.
  Actual tiled nav verifies disconnected footing/top and retained reversible
  approach, room, reserve and six-holding routes.
- Exact inherited-volume preservation retains 107,225 untouched boxes and 1,341
  bounded replacements with zero illegal losses outside the independent cuts.

The inherited west gate's immediate interior 4×4 m pad intersects the refuge's
south wall in its north 0.6 m. This leaf preserves that shell and proves the
clear court corridor at z371.4..375.4 and ordinary standing entry. It does **not**
certify a full-width turning transition at that corner. U-180 records the exact
observation and retains the full transition proof/resolution. Original O-C01 and
OG1 positions also remain explicit pending U-180; no V3 gun-angle acceptance is
claimed here.

## Reproduction and results

- `pnpm exec vitest run packages/tools/src/maps/qalatOutpostFurniture.test.ts`:
  **5/5 pass**, including the 192 controller attempts.
- Existing shell/nav focused run: 18 pass; the sole early failure was stale
  capture metadata while regeneration was in progress. Final full verification
  must retest the regenerated evidence and additional tower-nav test.
- `pnpm gen:qalat-depot` and its 26-view capture: pass; generated depot unchanged.
- `pnpm gen:qalat-outpost`: pass. Fourteen standing-eye captures use complete
  collision plus noncolliding cues and ordinary roof undersides; each has two
  draw calls, below 300. Final labeled capture rerun passes.
- `pnpm gen:nav`: pass for all five registered worlds; production bakes unchanged.
- `pnpm check:assets` and `pnpm check:packs`: pass.
- `pnpm typecheck` and `pnpm lint`: pass; `pnpm verify` is running.
- `pnpm sim-run --scenario mission --all-missions --seeds 3`: exit 0. Active
  Qalat remains 0/6, ordinary soldier-death losses; this is a diagnostic, not
  replacement-mission activation or a successful playthrough.

The first capture attempt lacked Playwright's downloaded executable; reruns use
`CHROMIUM_PATH=/usr/bin/chromium`. One capture interrupted during viewer editing
timed out; rerun after the viewer stabilized. No gate, timeout or budget changed.
CI must pass verify, streaming, parity-non-v8 and mission on the final pushed head
before authorized merge; the PR exposes the current head and actual run links.

## Review

Regenerate with `pnpm gen:qalat-outpost`, then
`pnpm exec tsx packages/tools/src/capture-qalat-outpost.ts` (set `CHROMIUM_PATH`
only when using an existing system Chromium). Open
`packages/tools/src/maps/outpost-review.html` through Vite for orbit review, or
inspect `artifacts/qalat-outpost/` for all gates, rooms, court cover, tower,
radio equipment and cell trim. The pictures are construction evidence, not an
owner look/play verdict. No human acceptance is invented.
