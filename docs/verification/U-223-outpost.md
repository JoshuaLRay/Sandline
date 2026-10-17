# U-223 — Refuge screen and outpost engineering closure

Owner-approved Option B, recorded before implementation in [the task card](../backlog/U-223.md).
Construction stays isolated until U-117; human whole-mission acceptance remains U-119.

## Construction

One solid screen at centre (28.6,8,377.8): 4 m north-south, 1.2 m thick,
4.8 m high (top y12.8). Its west edge x28 preserves the x24..28 court passage;
the refuge's x22.6..26.6 outside landing and z378..382 door stay clear. Its south
end z375.8 stays outside the z371.4..375.4 court lane. The gate, doorway,
(16,8,380) hold, original escort leg and existing cover remain fixed.
The raised top blocks production mobile rays which clear ordinary 2.2 m cover.

## Visibility regression

The original geometry reproduces the east-pad exposure. The final regression
uses 15 supported standing/crouched observer positions on the east gate and R9
pad, 36 body samples across the hold footprint, weapon eyes, settled desktop
arms with both shoulders and ADS, and mobile orbit/zoom in portrait/landscape.
Camera rays use the actual view direction and frustum; weapon eyes test every
body sample in every direction. The prior U-222 omnidirectional camera proof
for all six captive holdings remains unchanged. Removing only the new screen
restores exposure independently for weapon, desktop and mobile views.
Final visibility result: **zero exposed body samples** across 46,110 weapon-eye
and camera positions / 161,377 in-frame or weapon rays. Removing only the screen
restores 39,657 views: 368 weapon, 10,003 desktop and 29,286 mobile. The original
visible wedge crosses x28 at z375.981..379.059 and no higher than y12.492;
the four-metre screen covers it with margin. Complete-suite results follow below.

## Navigation and retained shelter proofs

The two screen bypasses and original cell → antechamber → court → refuge leg
run on the real standing bake/controller. Seven actual Session actors cross to
the east side of the screen, return to the refuge, then retain the below-west-
stair hold and return. U-221's 18 join/direction/spread traversals, six rescue
stands, roof/escape/isolation proofs and U-222's ordinary shell/blast controls
remain required. The earlier focused shelter run passes all 96 obstructed shots,
84 arcing lays, real wall and roof cover fractions and exposed-POW control.

## Artifacts and verification

Outpost construction manifest, plan, exact collision/render surface and eighteen
WebGL captures are regenerated, including east-pad-refuge and refuge-screen.
The large surface/level files remain ignored. All eighteen captures match the current collision/render hashes and use two
draw calls each. No human playtest verdict is claimed.

| Verification | Result |
|---|---|
| Seven focused outpost suites (72 cases) | All cases pass after updating the freshness fixture from sixteen to eighteen captures; affected ten-case suite rerun passes |
| East-pad weapon/desktop/mobile concealment | 46,110 positions / 161,377 rays; zero exposed samples; screen-only removal restores all three view types |
| Original escort leg and both screen bypasses | Real standing bake/controller, 775 ticks, no vault/stance change |
| Seven-actor screen round trip and retained stair hold/return | 1,203 ticks; all seven return alive; no failed order |
| U-221 join/direction/spread matrix and six rescue stands | All eighteen seven-actor traversals and physical rescue access pass |
| U-222 tank projectiles and blast controls | 96 obstructed shots / 12 origins; 84 arcs; wall/roof cover fractions retained; open-court POW takes 80 |
| Furnishing/escape and room isolation | 192 furniture/tower attempts; 1,610 boundary/room attempts; no escape; original camera/order/perception/roof proofs pass |
| Outpost generator and capture runner | PASS; 110,509 collision boxes, eighteen views, two draws/view |
| Registered navigation generator | PASS; no active-world nav changes |
| Asset budgets / pack coverage | PASS |
| Qalat mission diagnostic, twenty seeds at both budgets | Exit 0; existing live-map warning: 0/40 completions, deaths at rescue objective |
| All-mission diagnostic, three seeds at both budgets | Exit 0; greybox 1/6, mission-01 2/6, Qalat 0/6 completions; Qalat warning retained |
| Full `pnpm verify` | Mandatory typecheck/lint/test gate; latest run and result in PR #364's `verify` check; required successful before merge |

The snapshot failure was an outdated expected capture list, repaired by requiring
both new views; no geometry, navigation, damage or visibility assertion was removed.
Required CI `verify`, `streaming`, `parity-non-v8`, and `mission` must all succeed
on [#364](https://github.com/JoshuaLRay/Sandline/pull/364)'s latest head before its
expected-head-guarded squash merge. The PR checks are the latest-head CI record.

Reproduce the focused suites with `pnpm exec vitest run
packages/tools/src/maps/qalatOutpost*.test.ts`; then `pnpm verify`,
`pnpm gen:qalat-outpost`, `pnpm exec tsx packages/tools/src/capture-qalat-outpost.ts`,
`pnpm gen:nav`, `pnpm check:assets`, `pnpm check:packs`, and the two mission
diagnostics listed above.

## Readiness

After U-223's engineering gates pass and merge, U-116 has no remaining engineering
blocker. U-117 still requires U-112 (new physical-phone cache acceptance through
U-148) and U-113 (current-map prisoner placement/restart contract through U-144).
No further replacement-map construction leaf is READY. The next available
Qalat-focused engineering task is U-219 (READY): port the existing Qalat route
proofs to declared approach graphs, with equivalent proofs and no geometry
change. The integration unblocks remain U-148's physical-phone acceptance and
U-144's placement/restart contract. Human whole-mission acceptance remains U-119.
