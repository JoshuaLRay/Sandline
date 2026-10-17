# Development and QA commands

On-demand reference for `AGENTS.md`; consult only relevant rows (grep for the U-ID or command).
Paths in command descriptions such as `client/`, `tools/` and `data/` are
package-relative (`packages/client`, `packages/tools`, `packages/shared/src/data`).

| Command | What it does |
|---|---|
| `pnpm verify` | typecheck + lint + test — the gate every task must pass |
| `pnpm agent:run -- pnpm verify` | opt-in command wrapper: same test/exit code, saves full local log under ignored `.agent-logs/`, shows concise result and bounded failure excerpt (see `docs/AGENT-OUTPUT.md`) |
| `pnpm host` | authoritative session host — six slots, real WebSocket |
| `LINK_LATENCY_MS=100 LINK_JITTER_MS=20 LINK_LOSS=0.05 pnpm host` | same host with link sliders on the wire — latency counts **each way** |
| `pnpm --filter @sandline/client dev` | renderer dev server at localhost:5173 |
| `pnpm bot --count 2 --ticks 600` | netcode check in-process on a virtual clock |
| `pnpm bot --url ws://localhost:8080 --count 2 --ticks 600` | same bots over real sockets; numbers should match the line above |
| `pnpm bot --url ws://localhost:8080 --room K7PM --count 1` | a bot into a room people are in |
| `?host=ws://…&room=K7PM` | pre-fills the lobby |
| `?qa` | the QA layer — the readout, tuning panels and netgraph — shown from the start; without it the page is the game (the demo face, T-5.07) and H brings the layer back |
| `?enemies` | three riflemen on the in-page range (one standing, two patrolling), respawned after each despawn; `?enemies=rpg` makes the standing one an RPG gunner (U-157): it shoulders the RPG-7 with a glint for its wind-up and fires at the squad bunched at the spawn line (U-158); the QA panel (H) shows `rockets  trails … launches … wind-ups …` |
| `?squad` | the in-page bots run the `friendly` tree with the range's cover: they follow in formation, fight, and take orders — hold Q for the wheel (the mouse picks, 1–6 a slot, 7–8 a fireteam, 0 everyone; release to order), tap F to mark; add `&suppress` or `&enemies` for someone to attack |
| `?suppress` | a rifleman on the in-page range firing past your camera at the squadmate beside you — the suppression vignette, desaturation, jolt and crosshair |
| `MAX_ROOMS=4 ROOM_GRACE_MS=60000 pnpm host` | rooms per process and how long an empty room lives |
| `WORLD=range pnpm host` | the named world every room is built with (`data/worlds/*.json` and, since T-4.09, the levels in `data/levels/*.json`): `range` (the default) or `greybox-01`, the mission map (T-3.31), now the first level |
| `?assets` | every asset in the manifest through the real loader and decoders, stood in a row behind the spawn line (turn round); a grey box is one that failed, and the console says why (T-4.05) |
| `?codeweapons` | the old code-built weapon models instead of the generated period weapons (T-4.36): the squad's M4, DMR, shotgun, pistol, M67, AT4 and M249, and the enemy's AK, PKM and RPG-7 |
| `?codetank` | U-070's code-built stand-in for the enemy tank instead of the generated model (U-126), for comparison |
| `?codesoldier` | the squad in the old code-built soldier instead of the detailed desert-camouflage one (T-4.08), and enemies in it instead of the fighter (T-4.35), for comparing; `?greybox` is the rig's grey-box fixture |
| `?kit` | the kit gallery level (`data/levels/kit-gallery.json`, also the lobby's **Kit gallery** map): every kit piece labelled in a grid, three turned copies, and a house built from the kit with a stair to its roof, all walkable (T-4.10) |
| `?mission` | the mission in the page (`mission-01`, the first level, since T-4.09; the lobby's **Mission** picker has the grey-box layout): the slice mission (T-5.02): five objectives on the HUD — the west-lane patrol, the east-lane position, take and hold the compound, defend it, fall back to the start line — about ten minutes, P to retry from the last checkpoint once it is lost; add `&squad` for bots that fight beside you |
| `?world=greybox-01` | the in-page session on that world: the mission map's two lanes, the objective compound behind them |
| `JOIN_KEY=… pnpm host` | every Join must carry this key (lobby's Key field, `pnpm bot --key`); `IDLE_TIMEOUT_MS` / `MAX_SESSION_MS` drop idle and long-connected players (0 = off) |
| `IDENTITY_SECRET=… pnpm host` | the key(s) player-identity tokens are signed with, comma-separated, 32+ characters each; unset, a random one per process, so identities die with it (T-4.22) |
| `HOST_AI=1 pnpm host` | rooms get the AI the page has: the world's navmesh and cover, friendly bots that follow, fight and take orders, and the mission on the mission map. The lobby's **Mission** picker chooses the world a new room is built on (protocol 23). The deployed QA host runs it (`fly.toml`); off by default so `pnpm bot --url` stays comparable |
| `AI_DEBUG=1 pnpm host` | clients may ask for AI debug reports (B in the page); without it the host sends none |
| `curl localhost:8080/healthz` | rooms, players, protocol version |
| `pnpm sim-run --scenario crowd --ticks 1800` | headless simulation, reports µs/tick |
| `pnpm sim-run --scenario fall --ticks 1000 --parity` | two instances, reports divergence |
| `pnpm sim-run --scenario cover-duel` | a rifleman against a scripted shooter over 20 seeds; reports and asserts time to cover, exposure, reloads and relocation (T-3.20) |
| `pnpm sim-run --scenario pinned` | two riflemen in a group against a soldier holding cover over 20 seeds; reports and asserts suppression kept up, flanks reached and route exposure (T-3.21) |
| `pnpm sim-run --scenario mg` | the MG and the rifleman through the same pinned and flanked fights over 10 seeds; reports and asserts suppression per second, relocations, and that the MG never fires undeployed (T-3.23) |
| `pnpm sim-run --scenario rpg` | the `squad` fight with two riflemen and two RPG gunners over 10 seeds; reports and asserts riflemen killed, runs with a gunner hit, runs with rockets, no rocket bursting with the gunners' own side in the blast, no friendly hits and bots dead a run (U-157) |
| `pnpm sim-run --scenario squad` | five friendly bots and a human lead against three riflemen over 10 seeds; reports and asserts kills, no friendly hits, bots downed and revived (T-3.26) |
| `pnpm sim-run --scenario mission --seeds 20` | six friendly bots play the grey-box mission at the director's one- and six-human budgets; reports completion rate and time, enemies under fire in cover, suppression episodes per engagement, and AI cost at 40 enemies and 5 bots; asserts the floors in `scenarios/mission.json` (completion only over 10+ seeds), and on every run that the map never stands empty (nothing alive, nothing queued) past `maxEmptySeconds` during a timed objective (U-001). CI runs `--seeds 20` (U-085; it was `--seeds 3`, which cannot measure a completion rate) |
| `pnpm sim-run --scenario mission --all-missions --seeds 3` | discover every JSON in `packages/shared/src/data/missions/`, play three seeds at both budgets, and report completion or the stopped objective and reason per mission. Gameplay losses are warnings (B-11); invalid files, runner errors and a stalled encounter (U-001's empty-map ceiling) fail. Use `--mission path/to/mission.json` for any individual mission file (T-4.17) |
| `pnpm bench:rapier` | deterministic vs default vs SIMD physics cost |
| `pnpm bench:nav` | Recast init, bake and Detour query cost |
| `pnpm gen:trig` | regenerate the committed trig table |
| `pnpm gen:art` | write every code-authored piece (`tools/src/art/pieces/`) as `assets/src/<id>.glb`; run `pnpm gen:assets` after it. A test fails when a committed source is not what its generator writes (T-4.04, ADR-018) |
| `pnpm gen:audio` | render every sound recipe (`data/audio/sounds.json`) into `client/public/audio/`; a test fails when a recipe or the DSP changes without it (T-2.44) |
| `pnpm gen:voice` | turn the voice uploads in `assets/voice/raw/<name>/` (recorded from `docs/audio/voice-script.md`, each with its `CONSENT.md`) into the six slots' lines under `client/public/audio/voice/`; a test fails when an upload, `voices.json` or the pipeline changes without it (T-2.48) |
| `pnpm bake:light` | inspect a level (mission-01 by default) for T-4.12 lightmap UV/instancing compatibility and print the recorded spike outcome; it writes no files |
| `pnpm gen:assets` | process every source glTF in `assets/src/` into `client/public/assets/` and the manifest; required after adding or changing a source (a test fails until you do) |
| `pnpm check:assets` | every asset in the manifest against ADR-013's budgets (`data/assets/budgets.json`), by class; exits 1 naming the asset and the number when one is over |
| `pnpm check:packs` | T-4.06 streaming: log/assert the initial asset pack under 80 MB and verify every level pack contains its placed assets |
| `pnpm check:load-time` | T-4.06: after building the client and installing Chromium, time the first playable mission frame on a throttled link; asserts <30 s |
| `pnpm perf:frame` | T-5.04: after building the client, the slice mission with the squad in Chromium — a walk and a firefight — printing frame time (median, p95, worst), draw calls and triangles; asserts ADR-013's 300 draw calls, records frame time (headless is software, not target hardware). `?perf` shows the same numbers live on any machine |
| `pnpm export:soldier` | write the code-built soldier as `assets/src/soldier.glb`, the pipeline's test asset |
| `pnpm gen:nav` | re-bake every named world's navmesh; required after editing a world, `MoveConfig` or the hitbox (a test fails until you do) |
| `pnpm gen:qalat-outpost` | U-175: generate isolated prisoner outpost and screened reserve-annex shells in `artifacts/qalat-outpost/`; run `pnpm exec tsx packages/tools/src/capture-qalat-outpost.ts` for eighteen standing-eye gate, court, room, tower, furnishing, reserve-bend, U-180 V3 gun-line west-turn and refuge-screen captures with exact geometry hashes, supported footprints and <300 draws; activation U-117, whole-mission human quality acceptance U-119 |
| `pnpm gen:qalat-depot` | generate the isolated furnished B1–B9 depot, B0 loading vestibule, covered B0/B10 stairs and exact D0/west-landing joins in `artifacts/qalat-depot/`; run `pnpm exec tsx packages/tools/src/capture-qalat-depot.ts` for twenty-six standing-eye room/furniture/stair/porch captures and draw-budget evidence; integrated group/floor/escape evidence in [U-173](verification/U-173-depot.md), whole-mission acceptance U-119, activation U-117 |
| `pnpm gen:qalat-insertion` | U-138: compile the isolated Juniper Hollow replacement section and its exact collision/render surface, manifest and plan into `artifacts/qalat-insertion/`; production campaign activation remains U-117 |
| `pnpm gen:qalat-road-supports` | U-149/U-159–U-165/U-167/U-168/U-151/U-152: extend the isolated insertion with the bent y8 road, closing rock, road cover, toll office, orchard, loading façades, D0 return store, first-X5 ingress dogleg/screens and the furnished R0–R9 ridge shelf/service bridge with its V1–V3 support bays, F3 and two C12 road↔ridge stairs; preserve basement voids, the 12 m vehicle corridor and ridge views; exact collision/render scene, sight/clearance proofs and review plan in `artifacts/qalat-road-supports/` |
| `pnpm test:parity-browsers` | parity on Firefox + WebKit (needs `playwright install firefox webkit`) |

## Isolated furnished prisoner outpost (U-175/U-179/U-180)

Run `pnpm gen:qalat-outpost`, then
`pnpm exec tsx packages/tools/src/capture-qalat-outpost.ts` to regenerate the
exact collision/render union, construction manifest, plan and eighteen WebGL views in
`artifacts/qalat-outpost/`. The capture runner checks the collision and render
hashes, each 0.7 m standing footprint at its floor (V3's at y26), solid interior ceiling undersides and
<300 draw calls. Roofs remain in every view. Streaming CI uploads the complete
`qalat-outpost-review`; commit its compact manifest, plan, capture metadata and
PNGs. The large level/surface JSON files remain ignored.

For interactive review, run `pnpm exec vite --host 127.0.0.1` at the repository
root and visit `/packages/tools/src/maps/outpost-review.html`. These isolated
construction views leave production activation to U-117 and human quality
acceptance to U-119. U-222's live captive/escort tank-shell and blast shelter proofs
are `qalatOutpostShelters.test.ts`. U-180's tactical proofs (V3 gun
line, support rays/blind spots, west turn, sockets, OG6 patrol, P-OUTPOST and
reserve camera concealment) are `qalatOutpostTactical.test.ts` and the U-180 cases
in `qalatOutpostNav.test.ts`.

U-221 adds `qalatOutpostTraversal.test.ts` (all three joins, both directions,
three spreads, seven actual Session actors) and `qalatOutpostIsolation.test.ts`
(full standing-nav component, registered boundary crossings, roof weapons/blast,
desktop/mobile cameras and real wire orders/perception). Narrow side-pad exits
use ordinary individual move orders to finish staging after the initial group
order; U-174 packed formation completion remains separate. U-222 adds
`qalatOutpostShelters.test.ts` (live Session tank shells, wall/roof cover and
open controls), the below-west-stair escort route in the traversal suite, and
the cell door leaf that screens carry-1 from production cameras. U-223 adds
standing/crouched east-pad weapon eyes and settled production-camera frustum
checks for the refuge hold, both screen bypasses, the original escort leg and a
seven-actor screen round trip before the retained below-stair hold/return.
The two added captures show the east-pad sight line and the refuge screen.

## Isolated Juniper Hollow construction (U-138)

This authoring fixture implements the replacement's southern S0–D0 section and
three continuation sockets. Its geometry source is
`packages/tools/src/maps/qalat-insertion.json`; its hostile observer coordinates
are verification probes in `qalat-observers.json`, not a second encounter script.
The active `qalat-road` campaign remains the earlier map until U-117 integration.

Run `pnpm gen:qalat-insertion`, then
`pnpm exec tsx packages/tools/src/capture-qalat-insertion.ts`. The latter starts
its own Vite server and captures five actual WebGL whitebox views under
`artifacts/qalat-insertion/`, checking the generated geometry hash and <300 draws.
Streaming CI uploads `qalat-insertion-review`. Commit the compact manifest, plan,
capture metadata and PNGs; the large generated level/surface JSON stays ignored.
For interactive review, run `pnpm exec vite --host 127.0.0.1` at the repository
root and visit `/packages/tools/src/maps/insertion-review.html`; orbit/zoom or use
Spawn, Decision court and Overview. These are construction views; terrain art,
D0 landmarks/signage and owner map/play quality remain U-118/U-119 gates.

`pnpm exec vitest run packages/tools/src/maps/qalatInsertion.test.ts packages/tools/src/maps/insertionSurface.test.ts`
checks production solid-nav baking and controller travel, exact y8 floors/starts,
width/headroom, perimeter escapes, the approved late-reveal bend and every S0 body
ray against southern terrain alone. Full patrol/reserve/ridge/tank interpolation
uses ≤1 m steps; both tank muzzle recipes include eight orientations. The court
reveal check samples the whole court and legal shoulders, measuring distance to
the nearest court floor boundary as defined in the construction addendum.

## Isolated road support construction (U-149)

`pnpm gen:qalat-road-supports` extends the accepted insertion into the exact
A0–A9 road and south-gate run, with U-159's bent A3, A4 and A7. New supports occupy
y5.5..8 only, reserving future basement space. The source is
`packages/tools/src/maps/qalat-road-supports.json`. The manifest's `sightLines`
records U-159's plan-view proofs (`roadSightLines.ts`): the longest straight view
inside the 12 m tank lane, the separated fight pairs and each fight's longest
bare-surface view; the plan draws the fights and that lane view.
U-160's rock (`qalatRoadTerrain.ts`, `qalat-road-terrain.json`) fills everything
off the walking surface from z84 to the gate, y5.5 up to at least 2.2 m above the
road, capped under the V1–V3 fans; the manifest's `terrain.rays` records each
bay ray's clearance and the temporary caps it crosses. U-161's combat source
(`qalatRoadCombat.ts`, `qalat-road-combat.json`) adds A-C01–12, the toll office,
orchard trunks, closed loading façades, frontage sockets and high shoulder
screens. The office floor carves its interior out of the closing rock. Its
cover proxies use recorded segment axes filled with stepped axis-aligned boxes.
`combatSightLines` certifies high blocker footprints inside the built box union
and bounds continuous views between valid standing endpoints over the whole
road and office surface, each complete fight apron and the three frontage
sockets. It expands the surface for rock skin clearance, erodes high blockers
by a proven bound on sampling displacement and excludes endpoints that would
put the controller's square body inside a solid. Low walls never count as high
blockers. U-151 adds the exact X0–X6 motor pool/service spur, its 12 m lanes,
36 m aprons, T-N/T-E rock, y14 canopy and retaining returns. A-C12 moves along
its shoulder to clear the ingress. The separate V3→X5 turret-height fan preserves
all seven original feet rays. `tankSweep` certifies continuous shared rotating
hull/turret clearance, full floor support and the real controller traces, including
the built bridge deck (2.8 m overhead), approaches, R8 landing/stairs and supports.
The manifest records travel without target contact and with a controlled ten-second
standing target in the safety radius; drive/fire ticks run, the wider encounter and
projectile flight do not. Current visibility alone does not stop drive, and authored
final facing remains U-117 integration. This remains an isolated construction fixture.

U-162 retains all named X origins and replaces the local X4→X5→X6 links with
the J1/J2/J3/X5/J4 dogleg in §11.1, 12×12 m junction pads, a 7×7 m X5 track
patch and opaque forecourt fin/canopy/key/tongue. The entire carriageway remains
12 m clear; two 4 m firing/infantry channels retain A8→X5 and the fixed
A-C12 pad→X5. Sealing the sole A8 throat must still disconnect every approach.
The canopy/key clear the 8 m ridge footprints. U-164 replaces the separate R8
clearance fixture with the built y12 landing x66..74/z348..352: its 0.6 m slab
has underside y11.4 and 0.2 m turret clearance. The full authored and both
controller traces certify the completed bridge, stairs, landing and supports;
lowering the actual landing underside to y11.19 must fail.
`qalatForecourtScreening.test.ts` checks production hull/turret/muzzle targets
at sixteen yaws from both complete A-C11/A-C12 pads on a ≤0.5 m grid and V3,
at prone/crouch/standing eye and body heights. It removes future outpost interior
rock from blockers, checks the pads remain supported and clear, hides listed
X0–X4, exposes X5 at the three firing centres, and records first visible targets
on every ≤1 m approach station. Every visible approach target must come from a
producing yaw whose actual capsule contacts the fixed X5 mouth x48..60/z328..340,
using exact capsule-axis/rectangle distance. The secondary 8.9 m origin bound
is its required 6 m half-width plus actual capsule plan reach (2.9 m); sampling
adds no acceptance allowance. The log records the finite first-transition
interval and does not claim an exact continuous visibility boundary. This regression supplements
the continuous tank sweep; retained road bounds do not prove spur screening.
Run `pnpm exec vitest run packages/tools/src/maps/qalatForecourtScreening.test.ts`
for the focused first-X5 measurements, and retain the ingress screening/sweep/nav
and return rocket/blast suites below.
The current local 4/4 first-X5 proof checks 1,933,995 listed-node and 69,868,652
approach semantic rays (1,141 observers, 339 targets, 16 yaws, 187 stations).
Earliest A-C11/A-C12 origin is (55.75,8,340.5625), 6.791826 m before X5;
V3 is (55.5,8,339.625), 5.821566 m before X5. Their production capsule is
already in the fixed mouth; the finite transition interval is approximately
0.9703 m. This local result does not replace the inherited suite or CI gates.

U-152's `qalat-return-shelters.json` adds D0's exact 8×8 m clear store, y8 floor,
y12 ceiling, 0.6 m outward walls and 4 m west door/connector. The holding socket
is (50,8,58). Its floor carves the shell out of the insertion rock; the normal
tiled standing nav still preserves the D0→S3 and depot connections. The return
combat regression launches real rockets from six supported road firing choices
and applies ordinary blast damage to actors behind road/store cover and insertion
terrain, with exposed controls. Ridge/outpost/basement proofs remain on
U-140/U-141/U-116/U-119 until those structures exist.

U-163's `qalat-ridge.json`/`qalatRidge.ts` cut the continuous R0–R7 ridge
shelf: 8 m stepped ribbons on 0.05 m rows (≤5 cm edge/riser rasterization),
§6.1's landings and R3 shelf, ten-riser flights of 0.20 m risers on 0.40 m treads
spaced evenly with ≥2 m rest landings. The T-E body and a 1 m barrier ring stand
≥2.2 m above every adjacent floor; north of z300 the road rock stands back by
that ring. Temporary caps closed the V1–V3 bay fronts until U-167. U-164 replaces
the R7 mouth caps with the bridge/descent and caps the east gate for U-116.
Screening proofs count permanent solids only (`isTemporaryRidgeCap`, now just
the east-gate cap); the six U-162 reveal captures render the whole scene. Run
`pnpm exec vitest run packages/tools/src/maps/qalatRidge.test.ts packages/tools/src/maps/qalatRidgeBridge.test.ts packages/tools/src/maps/qalatRidgeNav.test.ts`
for the stair recipe, edge, fan, travel, mouth, island and escape proofs.

U-164 adds the exact y16 service deck x66..74/z330..342, underside y14,
two 8 m approaches with twenty 0.20/0.30 m steps and a 2 m landing each,
the exact R8 landing and twenty 0.20/0.40 m risers toward R9. The final
descent remains at y12 until its full width clears the tank-road junction pads.
Parapets and rock returns reject drops onto the road; nav/controller travel
reaches R9 in both directions without a new road↔ridge crossing.

U-165 furnishes the exact shepherd hut, broken survey post and four north-south
ridge cover sockets. Both shell west faces open onto supported dead-end recesses;
the hut stays roofless, with four sacks on its east wall, and two survey beams
attach above standing clearance at underside y29. The survey's 1.4 m broken
southwest return and a bounded 6.54 m² flat-rest bevel keep the continuous 8 m
lane past R6 without moving its stairs, named floor coordinates or F3 reservation.
`qalatRidgeClearance.test.ts` independently proves full-width R3/R6 transitions;
`qalatRidgeFurniture.test.ts` checks exact construction, access and 320 escape
attempts from sacks/low cover/high-rock faces. The actual R5 cannon projectile
stops at built high rock, ordinary blast rules reduce positive actor health damage,
and a controller walks from R5 to the hold and back through real exposed danger.
The hold is (95.8,30,238); U-141 builds the C12-U route to its existing R5 endpoint.
An adjacent exact-impact-face blast exposure issue is recorded in U-166;
U-165's exposed control additionally receives a real ordinary direct cannon hit.

U-167 replaces the V1–V3 bay caps with §6.2's bays: each anchor's 0.8 m floor
strip, a rock lip on its western 0.25 m under a canopy whose low edge leaves a
0.70 m opening (below the 0.8 m prone body), a 3 m canopy behind it and
full-height side returns. V3's lip steps down northward so its south-gate and
X5 rays clear it, keeping every reachable lip above the 0.45 m step. Rock west
of each lip stays 0.3 m under the fans; the frame itself is exempt but leaves
every listed ray open (manifest `ridge.rays[].frameGapM`). F3 is one explicit
y36 fin. `qalatRidgeBays.test.ts` checks construction, target rays from each
anchor's standing eye, F1/F2/F3 blind spots and four-stance escape attempts.

Run `pnpm exec tsx packages/tools/src/capture-qalat-road-supports.ts` after
generation for seventy-four 1440×1000 exact-scene views and geometry/draw measurements,
including the road fights, motor pool/retaining turns, occupied bridge, V3→X5 opening,
CAP-RETURN, store door/holding socket and the six road rocket firing choices.
The six added A-C11/A-C12/V3 X4-hidden/X5-visible views display production
hull/turret capsules; pixel-difference assertions require zero tank pixels at
X4 and a visible body at X5. They retain the preceding twenty-eight views.
U-163 adds standing eyes on R0–R6, a free R7 bridge-mouth view and a ridge overview;
U-164 adds standing eyes on R7/R7b/R8/R9 (R7's capture sits 0.5 m south of
its node on the retained pad), a tank under the bridge and the R8 underside.
U-165 appends eight standing-eye views of the hut/spur, survey interior, four
cover choices and sheltered/exposed R5 hold positions, retaining all 49 prior views.
U-167 appends five bay standing eyes (V1/V3 anchors and rears, V2 anchor) and a
free F3 view; with the bays built, every view renders the whole scene.
U-168 appends nine standing eyes at the two C12 mouths and their interior
waypoint landings, plus two free stair overviews. Its exact four-metre ribbons
and 4×4 m waypoint pads use 0.20 m risers and 2 m intermediate rests; the
owner-approved compact treads on constrained flights preserve the named spines
and eight-metre ridge route. A 0.5 m rock band 2.2 m above the higher adjacent
floor lines both stairs; inside V1's fan it is a lip under a canopy (0.7 m slot).
The construction manifest records every flight and the rock/lip/canopy counts.
`qalatC12.test.ts` measures actual risers and full widths; `qalatCrossingsNav.test.ts`
walks both spines each way and all twelve Tight/Standard/Wide seven-body trips
using the ordinary Formation, POW escort Brain, PathFollower and body separation.
`qalatCrossingsEscape.test.ts` checks stair-edge/landing escape attempts and the
A2 apron edge. The inherited ridge nav isolation test now seals D0, C12-L and
C12-U together; ridge, bay and terrain proofs exempt only the R2/R5 open mouths.
CAP-X ingress now shows the built deck with a production tank capsule at J1.
U-169's `qalatSurfaceNav.test.ts` checks the live Detour junction portals and
single-goal route sequences; `qalatSurfaceEscape.test.ts` runs 8,460 integrated
jump/vault/crouch/prone/drop attempts, checking every grounded storey.
`qalatC12TerminalEscape.test.ts` pins both reproduced chained climbs: existing
cheek heights now include sprint-jump reach, and the A-C03 edge guard meets the
mouth guard. `qalatRidgeReturnCombat.test.ts` proves real standing rockets from
V3 to A8 and C12-U's U1 landing to A5, tank blast damage and actual canopy-cover
attenuation; V3→X5 rockets are not certified. Run these files with `pnpm exec vitest run`.
Streaming CI uploads `qalat-road-support-review`. Commit manifest, plan,
capture metadata and PNGs; large level/surface JSON stays ignored. For orbit
review run `pnpm exec vite --host 127.0.0.1` from the repository root and open
`/packages/tools/src/maps/road-support-review.html`. The capsule is a scale probe.
Eye-height and free-camera captures are construction evidence, not human acceptance.

`pnpm exec vitest run packages/tools/src/maps/qalatRoadSupports.test.ts packages/tools/src/maps/qalatRoadTerrain.test.ts packages/tools/src/maps/qalatRoadCombat.test.ts packages/tools/src/maps/qalatRoadCombatGeometry.test.ts packages/tools/src/maps/qalatRoadCombatElevated.test.ts`
checks approved coordinates and full widths/aprons, actual solid-nav/controller
traversal for all six starts in both directions, backing-floor and rock-top
disconnection, reserved basement volume, exact built bridge and inherited southern occlusion.
Its nav bake keeps the backing plane only under the built content: Recast's
compact heightfield indexes spans in 24 bits (`MAX_COMPACT_SPANS`, 16.8 M) and
the solid rasterizer refuses a bake past it. `bakeRoadSupportNav` tiles the full
A/X content at unchanged 0.1/0.05 m resolution, with erosion padding and no new
links; production registered-world bakes remain unchanged. `qalatTankIngressNav`
walks A8↔X0 and proves closing only the A8 throat removes every other approach.
`qalatTankIngress` pins geometry/clear widths/aprons/voids, `qalatTankSweep` tests
continuous certificates and actual controller timing, and `qalatTankIngressScreening`
checks actual hull/turret/body/muzzle rays, including insertion over the full route.
`qalatRoadTerrain.test.ts` proves U-160's rock: off the road, every edge closed,
inside corners solid, bay rays and fans clear, 3D fight separation and escape
attempts. `qalatRoadCombat.test.ts` checks the conservative physical-cover sight
proof; `qalatRoadCombatGeometry.test.ts` checks the authored cover and landmarks,
frontage sockets, regroup pads, infantry passages, vehicle corridor and inherited
ridge views. It also runs production-controller sprint-jump attempts from the
six low-cover tops, rejecting falls off the supported route and landings on
outer rock or high screens.
`qalatRoadCombatElevated.test.ts` checks actual 3D hostile-eye rays to standing
heads on those low-cover tops: supported, clear road eyes on a 1 m grid against
target footprints expanded by the projected controller square and sampled at
≤0.5 m spacing, including bounds and vertices.
Every sampled ray longer than 90 m must meet a solid. This finite regression
supplements the continuous ground-height proof.
The existing U-138 suite retains its dense S0/court screening proof.
`pnpm exec vitest run packages/tools/src/maps/qalatReturnShelters.test.ts packages/tools/src/maps/qalatReturnSheltersNav.test.ts packages/tools/src/maps/qalatReturnCombat.test.ts`
checks the exact store shell, clear floor/door, screened holding samples, roof
isolation, bidirectional store/S3/depot travel and the real rocket/actor blast proofs.
Owner road map/play acceptance remains pending in U-139; the final swept tank
construction gate remains U-151.

## Mobile commander supply review (U-148)

Run `pnpm --filter @sandline/client dev` and open `/mobile-supply-review.html`
on the same server. This isolated authored-floor fixture uses the production
phone controls, Session, wire codec, confirmed inventory and mobile adapter.
Placement and the 30 Hz clock are controlled; distant navigation remains covered
by U-147's tests. The current production-map placement remains U-117.

Open **Supplies**, explicitly choose one commanded bot and cache, then one item.
Watch host collection/stock, cancel it, change recipient/cache, or use **Review
setup** for last-kit contention with a desktop hold and a commander reconnect.
Reload resets this fixture's stock. Watching the active human never makes that
human selectable. Test portrait/landscape, scroll to stock/progress/cancel, and
check safe areas on a physical phone; these steps do not record owner acceptance.

`pnpm exec vitest run --config vitest.browser.config.ts --project assets-browsers
src/ui/mobileSupplyChoice.browser.test.ts src/ui/mobileSupplySession.browser.test.ts`
runs the Session/browser regressions and writes U-148 PNGs under
`docs/backlog/evidence/`. After a client build,
`pnpm exec tsx packages/tools/src/capture-mobile-supplies.ts` checks the actual
production entry at both orientations, unavailable caches, order disarming and
settings dismissal. Set `CHROMIUM_PATH` only when using a preinstalled Chromium.
Automated captures do not replace the new physical-phone presentation/play verdict.

## Adding a mission (U-073)

Before authoring data, write the mission brief and a per-map record using the
[map and mission creation standard](design/MAP-MISSION-CREATION.md) and
[map template](design/maps/TEMPLATE.md).

A mission is its data files plus **one entry** in `packages/shared/src/sim/campaignRegistry.ts`; the world, mission,
encounter and script tables and the lobby's map list are all built from that list.

1. Author the data under `packages/shared/src/data/`: `levels/<id>.json`, `missions/<id>.json`, `encounters/<id>.json`
   and, if the mission has one, `scripts/<id>.json`. The level's `id`, the mission's `world` and the encounter's
   `world` are all `<id>`; the level's `encounter` names `<id>`.
2. In `campaignRegistry.ts`, import the files and add one entry (`id`, `world`, `mission`, `encounter`, `script`, and
   a `lobby` label and order if it should be offered in the lobby). A mismatched id is refused at import, naming the entry.
3. To put it in the campaign (U-088), add ONE entry to `packages/shared/src/data/campaign.json`: the mission id, a title, and its briefing and debrief lines. The order of the list is the order it is played in; an unknown id, a repeat or empty text is refused at import.
4. `pnpm gen:nav` bakes its navmesh and cover (it covers every registered world), then `pnpm verify`.
5. Nothing else needs editing: `level-check`, `check:assets`, `check:packs` and `pnpm sim-run --scenario mission --all-missions`
   find the mission from its files. `level-check`'s join table holds only the two legacy levels' exceptions: a new level has none.

`packages/shared/src/sim/campaignRegistry.test.ts` shows the shape: a throwaway mission built from copies of mission-01's
files under another id goes through every builder with no other edit.

### Qalat Road terrain and mission review (U-097)

These are **current U-106 build** review coordinates. For the owner-requested
replacement, use [U-107’s complete construction and verification specification](design/maps/qalat-road.md).
Its hidden spawn, ridge and basement are not implemented by the documentation PR.

Choose **The Qalat Road** in the lobby or open `?mission&world=qalat-road`. This is the live rescue/escort/tank mission from U-093/U-094/U-095. Start and extraction are `(0, -6)`; compound centre is `(0, 182)`.

Walk each lane north and south. U-106 narrows the riverbed to a winding 6 m
channel with 8 m holding pockets, bounded by continuous 6 m banks; its shallow
0.75 m sills remain near z=32/158. The 21 m road stays at y=0 and preserves the
tank's x=0/8 corridor. Terraces occupy x=25..41 at 1, 2 and 3.25 m elevation.
Only C12-S (z=42..46), C12-M (102..106) and C12-N (152..156) connect the road
to the terraces; walk their 0.25 m stairs in both directions. Outside the south
hub z=-14..16 and compound convergence z=169.8..200, the flank has no crossovers.

Review O1 `(11.8, 2.6, 60)`, O2 `(11.8, 3.6, 112)` and O3 `(11.8, 4.85, 164)`
(eye coordinates). Their low firing slots overlook the matching road stretch;
attempt standing/jumping/crouched/prone shortcuts and verify the lintels block
passage. Try the closed west-bank sections, a winding flank bottleneck and west
gate. Free the POW, return along each route with Tight/Standard/Wide squad spread,
regroup in the holding pockets, destroy the tank and extract all seven. Compare
commitment, congestion, support angles and blind spots. Owner verdict remains pending.
[Annotated overview](verification/U-106-qalat-overview.svg) marks the actual barriers,
hubs, crossings and bays.

`SANDLINE_LOAD_WORLD=qalat-road pnpm check:load-time` tests the 4 Mbit/s, 30 s budget. `pnpm exec tsx packages/tools/src/level-check.ts` validates authored geometry/routes and writes schematic renders. After a client build, `pnpm exec tsx packages/tools/src/capture-map-review.ts` captures production client views at ground and elevated positions; streaming CI uploads `qalat-map-review` with those PNGs. These are actual client renders with a QA camera, not an owner playtest verdict.


### Qalat authored art review (U-096)

Default campaign play has no diagnostic grid. Append `&grid` to `?mission&world=qalat-road` to request it for QA. The art pass skins U-097's existing supporting planes; look for grey dry-channel gravel, a dusty two-rut road, olive-brown fallow fields and worn compound paving. Sparse ankle-high scrub/gravel and twelve sub-step-height bank rocks sit off the tank corridor.

After `pnpm --filter @sandline/client build`, run `pnpm exec tsx packages/tools/src/capture-map-review.ts`. It writes nine actual production-client views, an explicit-grid comparison and `measurements.json` under `artifacts/map-review/`. It fails if the default grid appears, the requested grid is missing, or a view reaches 300 draw calls. Streaming CI uploads `qalat-map-review`. Compare the riverbed, road bank, lower/upper terrace, compound interior and overview with U-096's baseline images. Continue the U-097 north/south walking route above to review clearance and cover readability. A screenshot or green CI does not replace owner visual acceptance.

## Authoring stacked floors (U-108)

World mission start/objective/spawn circles, encounter areas, mission objective
areas and script enter areas accept optional `minY` and `maxY`. Supply both as
finite numbers with `minY <= maxY`; bounds include their endpoints and compare
actor **feet** height. Omit both for the legacy circle across all heights. A
caller without a feet height cannot satisfy a bounded area. Named encounter
areas retain their bounds when referenced by mission or script triggers.

For example, `{ "x": 0, "z": 10, "radius": 3, "minY": 7.5, "maxY": 8.5 }`
accepts a soldier on the surface at y8 and rejects one below at y0. This applies
to enemy/squad counts, reach/hold conditions, prisoner extraction and enter
triggers. Choose bounds wide enough to include navmesh surface offsets.

Enemy spawn zones additionally accept `y`, the physical supporting floor height.
Explicit `"y": 0` selects the basement under an overhead slab; `"y": 8` selects
the slab top. When bounds are present, y must lie inside them. Support must match
the authored floor within 0.05 m; nav projection must remain within 0.3 m both
horizontally and vertically, and the spawn must fit its collision headroom. A
zone with no valid candidates on an explicit floor fails with the zone name
rather than silently moving guards onto another storey. Bounds alone filter
candidates; use explicit y to select a lower floor.

Omitting y preserves legacy projection (highest support with navigation; y0
without navigation). Enemy occupancy only conflicts within 1.8 m vertically and
1 m horizontally; old callers without y conservatively block either floor.

U-108 supplies area and enemy spawn heights. The following sections describe
authored squad starts/vehicle paths (U-110) and navigation, cover and commands
(U-120–U-123). Fixed member sockets and the replacement map build remain tracked
in [U-111](backlog/U-111.md) and [U-114](backlog/U-114.md) through
[U-119](backlog/U-119.md).

### Authored squad starts and vehicle height (U-110)

World and level files accept a top-level `squadStarts` array containing exactly
six `{ x, y, z }` feet positions, in slot order. Each point needs full standing
clearance and support at its authored height within 0.05 m; overlapping slots,
non-finite coordinates and placements outside the floor/wire bounds are rejected
by name. For example, Mission 1's future insertion uses
`(-6,8,-10), (-2,8,-10), (2,8,-10), (-6,8,-6), (-2,8,-6), (2,8,-6)`.
Host, local and headless sessions consume this same world data. Fresh starts,
full restart, retry without a checkpoint and missing checkpoint slots use the
authored array; saved checkpoint positions take precedence. Full restart faces
authored slots north. Joining still possesses a bot at its current position.
Omitting the array retains legacy starts.

`spawn-vehicle` actions and encounter vehicle `path` waypoints accept optional
`y`. Supply the script spawn height, or the encounter's spawn-zone `y`, to name
the starting floor. Waypoints without y inherit the preceding height; fully
2D scripts and paths retain their existing ground-level behavior. An encounter
path with height requires an explicit spawn-zone height. Vehicles remain upright
and follow their supported feet height; this is an on-rails drive, not wheel
physics. An authored 3D route checks the spawn facing, body support and
hull/turret clearance, and samples segments every 0.5 m. During driving and
turning it checks collision, support and same-storey soldiers; it waits at an
obstruction or an unsupported ledge. It never projects onto an overhead bridge.
Both route/origin heights survive withdrawal, retry and JSON checkpoint restore.
Old checkpoint paths without y remain accepted.

Run the U-110 fixtures with:

```sh
pnpm exec vitest run \
  packages/shared/src/sim/squadStarts.test.ts \
  packages/shared/src/sim/vehiclePlacement.test.ts \
  packages/server/src/session/elevatedStarts.test.ts
```

These fixtures cover six starts and lifecycle fallbacks, a y8 road under a
y16 bridge, body/muzzle/shell/wire elevation, floor-separated occupancy and
checkpoint reload. The actual replacement Qalat geometry and insertion array
are authored in U-114; these fixtures do not claim a map playtest.

### Overhead navigation geometry (U-120)

The offline bake includes all six faces of every collision box, including a
downward-facing underside. A basement below an overhead slab remains walkable
only when the baked standing agent has sufficient headroom. Slab interiors and
undersides never become walkable floors. Author actual solid thickness in the
world geometry; visual ceiling meshes alone do not constrain AI navigation.

Geometry algorithm revisions are part of `navBakeHash`, alongside world boxes,
agent dimensions, links and cover inputs. Run `pnpm gen:nav` after changes and
commit the generated bakes. The three-layer regression is
`packages/tools/src/nav/stacked.test.ts` (feet y0/y8/y16). Projection, elevated
links, blockers, cover and command handling remain tracked under U-121–U-123.

### Floor-preserving navigation (U-121)

`NavMesh.resolvePoint(point, horizontalRadius, verticalTolerance?)` widens only
the horizontal search. The default vertical tolerance is 2 m and can be narrowed
for authored goals; a hit outside either final tolerance is rejected. `path`
and avoidance paths use this bounded resolver when given a search radius. A
goal on a tall, inaccessible wall no longer searches arbitrarily downward for
a floor. Callers must provide the intended feet height. Desktop/mobile command
conversion and replicated goals remain under U-123.

Scripted blocker boxes already supply `minY`/`maxY`; navigation now intersects
them with each polygon's floor-to-standing-head volume. Named-world loaders
use the baked agent height. A 2D blocker without vertical bounds still blocks
all intersecting floors, and overlapping blockers retain reference counting.

Vault candidates are sampled from every supported approach layer, including
elevated decks. A conservative swept standing-body envelope rejects vault/drop
links that intersect overhead or side obstacles. Intended vault obstacles and
source supports are exempt. The envelope may reject tight borderline traversals;
author generous clearance and inspect generated links. Link algorithm and vault
lip changes invalidate the bake hash: regenerate with `pnpm gen:nav`.

### Cover on stacked floors (U-122)

Cover baking samples all supported standing levels beside a wall, in ascending
y order, and checks nav membership and headroom. A slab overhead is not cover
for a soldier below it unless its side actually extends down to that floor.
The cover algorithm is part of the bake hash; run `pnpm gen:nav` after changes.

Runtime cover routes must reach both requested endpoints in 3D within the
controller's step-height tolerance, including nav voxel offsets. Partial paths
ending below the destination are rejected. Group flanks and suppressors use
the same complete-route rule. Other-floor cover remains valid when an actual
route connects it; authored combat bounds are a separate U-111 requirement.

Asker/friend positions are **feet**, threat positions are eyes. Crowding counts
only overlapping standing-height levels; arrival/departure uses 3D distance.
Firing positions need support and standing clearance. Sightline rays retain
their actual elevations, so visible ridge support fire remains possible.
`CoverSystem.invalidateGeometry()` clears cached usability and sightlines;
Session calls it whenever a scripted blocker changes.

## Fixed guard sockets (U-129)

An encounter group may provide `sockets`, ordered like its expanded `members`.
Each entry names a globally unique persistent member `id` (1–64 ASCII letters,
digits, `_` or `-`), the matching `archetype`, exact `{x,y,z}` feet and an `{x,z}`
facing target on its floor. For example, a one-rifleman group adds:

```json
"sockets": [{
  "id": "BG1", "archetype": "rifleman",
  "feet": { "x": -26, "y": 0, "z": 124 },
  "face": { "x": -20, "z": 108 }
}]
```

The group's existing `zone`, `posture` and `trigger` remain required for schema
compatibility. Socket members hold their individual post/facing until normal
perception alerts them; the group posture does not replace these assignments.
Use `posture: {"kind":"hold"}` for this leaf. Individual patrols/combat bounds
are described below (U-130); pre-placed inactive reserves and vehicle sockets
are described in [staged reserves](#staged-reserves-u-131).

Socket groups have exactly one wave and fixed counts. `fixedCount` may be omitted
or true; false/repeat waves fail validation. Total socket count must fit the
file's `aliveCap`; the runtime cap cannot fall below that count at a low human
budget. Unknown fields, mismatched counts/archetypes, duplicate identities,
overlapping members, unsupported feet and standing obstructions fail content
validation. The navmesh must resolve the named floor within the existing 0.3 m
spawn tolerance. Its small surface offset is used for validation, while exact
authored feet are kept; it never relocates a member to a different candidate.

Start-trigger socket groups populate at initialization before players receive
input, even when a human can see the socket. Map authoring must screen the
insertion as specified; visibility is not a reason to omit a fixed guard.
Later triggers without `staged` retain visibility/occupancy waiting at the one exact socket.
Other enemies occupying it delay that member independently of other sockets.
Legacy zone groups keep their
candidate selection, visibility checks, count scaling and repeated waves.

Checkpoints carry `spawnId` on living enemies and `socketId` on queued members;
wire net IDs remain ephemeral. Retry/save reload preserves member identity,
saved position and facing and marks dead members sent, so no guard returns at
its original socket. Full mission restart rebuilds all members. Legacy saves
without these optional IDs retain their previous format. Duplicate/malformed
member IDs are rejected by the durable parser.

Reproduce the content, Session lifecycle and real baked-nav checks:

```sh
corepack pnpm exec vitest run packages/shared/src/sim/encounterSockets.test.ts packages/server/src/session/guardSockets.test.ts packages/tools/src/nav/guardSockets.test.ts packages/server/src/ai/director/spawner.test.ts packages/server/src/session/checkpointWorld.test.ts
```

## Individual patrols and combat regions (U-130)

Each socket may independently add `patrol` and `combatRegion`. Other members
keep their own hold/facing assignment. Add up to 64 named `regions` at the
encounter's top level. Each is a union of 1–32 closed, axis-aligned 3D prisms:

```json
"regions": {
  "basement": [{
    "minX": -30, "maxX": -10,
    "minY": -0.3, "maxY": 0.3,
    "minZ": 108, "maxZ": 128
  }]
}
```

A socket in that region may add this assignment:

```json
"sockets": [{
  "id": "BG1", "archetype": "rifleman",
  "feet": { "x": -26, "y": 0, "z": 124 },
  "face": { "x": -20, "z": 108 },
  "combatRegion": "basement",
  "patrol": {
    "route": [
      { "x": -26, "y": 0, "z": 124 },
      { "x": -26, "y": 0, "z": 116 },
      { "x": -20, "y": 0, "z": 116 }
    ],
    "pauseSeconds": 3
  }
}]
```

Routes contain 2–64 exact feet points, starting at the socket; adjacent points
must differ. Every point needs support and standing clearance. The Session
checks every leg in both directions against the real navmesh before spawning,
including the assigned region. Unknown regions, invalid floors, incomplete
paths and paths leaving the region fail startup. `pauseSeconds` defaults to 3
(90 simulation ticks at 30 Hz); authored values from 0–60 round to whole ticks.
The guard pauses at its initial post and each endpoint, reverses at the far
endpoint, and passes interior points without pausing. Combat preempts patrol;
returning to idle resumes its phase and remaining pause. Retry and durable
reload preserve the full 3D route, direction, leg, region and remaining ticks.

Regions describe allowed **feet corridors**, including navmesh surface offsets,
stairs and vault transitions. Use separate vertical bands for separate floors;
add explicit volumes covering the entire corridor when a storey transition is
allowed. An X/Z rectangle alone does not distinguish stacked floors. Geometry
and nav connectivity still decide reachability: a prism grants no passage
through walls or to a disconnected bridge. The runtime resolves regions to
actual ground polygons and verifies every path segment against the exact union.
It conservatively rejects a native path that cuts across a prism boundary; it
does not clip that path or search for an alternative inside a partial polygon.
Author regions around complete traversable corridors and validate both patrol
directions on the final baked map.

Pursuit, cover reservations/ranking, group flank/suppressor paths, capture,
lever and gun goals all use the member's legal floor and complete bounded path.
A final movement check also constrains controller/avoidance/spacing output.
Members without `combatRegion` retain legacy unbounded navigation. No production
map sockets, nav bake inputs or generator outputs changed for this engine leaf;
replacement-map authoring and owner map/play review remain in U-114–U-117.

Reproduce timing, actual stair traversal, combat preemption, bounds and saves:

```sh
corepack pnpm exec vitest run packages/shared/src/sim/navigationRegion.test.ts packages/server/src/ai/actions/authoredPatrol.test.ts packages/tools/src/nav/boundedPatrol.test.ts packages/server/src/ai/group.test.ts
```

## Finite supply contract (U-132/U-133)

Mission scripts accept an optional top-level `supplyCaches` list (up to 64).
Declarations are static, separate from event actions and `pickup` weapon IDs:

```json
"supplyCaches": [{
  "id": "P-SOUTH",
  "feet": { "x": 50, "y": 8, "z": 58 },
  "stock": {
    "projectiles": { "rocket": 6 },
    "healthKits": 2,
    "primaryMagazines": 6
  }
}]
```

IDs are unique, case-sensitive, 1–64 ASCII letters/digits/`_`/`-`, beginning
with a letter or digit. Feet require all three finite coordinates within the
shared position range. Unknown fields, missing cache fields, non-carried
`smokecloud` stock and unknown projectile IDs fail validation. Stock fields are
optional (default zero); each authored amount is a whole number from 0–65,535.
The parser validates content; Session also rejects unsupported/obstructed feet
and a nav projection onto another floor, retaining the exact authored coordinates.
Existing scripts omitting `supplyCaches` retain their shape and behavior.

`transferSupply(stock, inventory, classCapacity, choice)` computes a pure preview
or completion result for one projectile type, one health-kit charge, or held
primary ammunition. Projectile transfers fill free class capacity only; slot-5
equipment must already match, while frag uses slot 4. A cache does not equip
gear or increase carried capacity. Health charges replenish one kit rather
than healing. Ammo fills missing whole rounds in the actual held primary
(including a held second primary), without refilling stowed guns or sidearms.
Rejected empty/full/incompatible attempts return the unchanged inputs.

Durable/replicated `SupplyStock` uses `primaryAmmoUnits`, where **2,400 integer
units = one magazine equivalent**. Each round costs `2400 / magSize`; all
shipped primary sizes divide this denomination. Import validation rejects
future magazine sizes that cannot be represented exactly. Sub-round remnants
stay in the cache, available to a compatible larger magazine; no rounding
creates stock. `parseSupplyStock` validates JSON in this stable denomination.
Changing the denomination requires a save/protocol migration, not retuning.

The timed-use defaults live in `data/supply-caches.json` (1 s, 2 m). Session
requires a seated living soldier, an explicit compatible choice, held E, same
floor, 3D feet distance ≤2 m and eye-to-cache LOS. Its existing input latch
tolerates gaps up to five ticks; a real release or longer silence cancels use.
Leaving reach/sight, becoming downed/dead, mounting, spectating, changing seats
or losing capacity cancels without stock cost. Revive, mounting, charge/weapon
pickup, upload and rescue retain their interaction priorities. One choice
finishes once; further held E needs another explicit selection. The Support's
existing interaction multiplier makes use take **0.8 s (24 ticks)** in class
sessions; others take **1 s (30 ticks)**. Free QA sessions retain their existing
capacities and 1× time scale.

Completion recomputes against current host stock and inventory, then commits in
stable slot order. Preview results are never reservations. Ammo must be in the
held primary, with no projectile/kit in hand; a sidearm cannot consume the pool.

Protocol 69 adds commander supply requests to the dedicated reliable supply
messages (introduced in version 66) and incompatible-restore choices (version
68), separate from pickup IDs:

| Message | Direction | Contract |
|---|---|---|
| `SupplySelect` | Client → host | `requestId` increases per connection; `cacheId` and one `item`, or `null` to cancel. Replayed/older IDs are ignored. |
| `CommanderSupplySelect` | Client → host | A separate increasing `requestId`, recipient `slot` 0–5, `cacheId`, and one `item`, or `null` to cancel. The host enforces autonomous command authority, class/fireteam reach and nearby use; travel and mobile controls remain U-147/U-148. |
| `Supplies` | Host → clients | `full` replaces all caches on join/restore; otherwise only changed caches merge by ID. Includes quantized feet and exact integer stock, even when empty. |
| `SupplyProgress` | Host → clients | All accepted choices, by seated slot, with cache ID, item and whole percent. The clock updates at 10 Hz; choice/cancellation/completion changes are immediate. An empty list clears all holds. |

`NetClient.selectSupply(cacheId, item)` sends a choice only after joining and
while no incompatible-restore gate is active; its `supplyCaches` and
`supplyProgress` getters expose host state without local inventory prediction.
`NetClient.selectCommanderSupply(slot, cacheId, item)` sends the commander
request under the same join/restore gates, with its own request counter.
`resetForRejoin()` clears cache/progress state and both counters; reconnect
receives current stock and starts no hold. U-134 presents accepted desktop
choice/use and desktop/mobile stock/progress/scenery. U-146 supplies host use
for an eligible autonomous recipient already beside a cache; it requires no
synthetic commander E input. Bot travel and the owner's future mobile-use
review remain U-147/U-148/U-145. The five actual production placements and their
exhaustive counts remain U-117.

Checkpoint-world format 1 gains optional `caches: [{ id, stock }]`. New worlds
save all caches and six soldier inventories together, and retry/JSON host reload
restore that pair. IDs must match the complete authored set and saved stock
cannot exceed its original pool; this check precedes any soldier restore.
Repeated restore/script execution does not add stock. Full restart rebuilds
authored stock and the original mission-start squad inventory. Legacy worlds
without `caches` remain readable. Map-revision restore quarantine/UI is U-136.

Reproduce content/transfer rules and legacy script compatibility:

```sh
corepack pnpm exec vitest run packages/shared/src/sim/supplyCaches.test.ts packages/shared/src/sim/areas.test.ts packages/shared/src/sim/campaignRegistry.test.ts
corepack pnpm exec vitest run packages/server/src/session/supplyCaches.test.ts packages/shared/src/net/supplyWire.test.ts packages/client/src/net/supplyCaches.test.ts
```

### Cache presentation fixtures (U-134)

The normal gameplay HUD uses Tab mouse access to choose one compatible item,
then held E to use it. Release E interrupts the host hold; hiding the HUD control
or leaving reach/LOS cancels the choice. Spectators view stock/progress beside
the watched soldier; U-145's commander resupply is approved and U-134's review
accepted. U-146–U-148 retain command authority, collection travel and mobile use.

`pnpm --filter @sandline/client dev --host 0.0.0.0` serves
`/supply-review.html` and `/supply-review.html?mobile` for isolated live review.
The five-cache fixture uses representative Mission 1 stock on the greybox floor,
not production placements. Its cache buttons reset carried deficits for review
while keeping spent host stock. The browser tests write thirteen portrait and
landscape captures, including partial ammo, contention and exhausted boxes:

```sh
pnpm exec vitest run packages/client/src/ui/supplyModel.test.ts packages/client/src/ui/supplySession.test.ts packages/client/src/net/supplyCaches.test.ts
pnpm exec vitest run --config vitest.browser.config.ts --project assets-browsers packages/client/src/ui/supplyChoice.browser.test.ts
```

See [U-134](backlog/U-134.md) for capture links and pending owner review steps.
No generated asset/audio/nav inputs changed in this presentation leaf.

## Staged reserves (U-131)

Set `staged: true` on a one-wave fixed-socket encounter group. Its members are
placed at initialization, before input (or at ready-up in a lobby), and count
toward the encounter cap and Session hard cap while dormant. Start-trigger
socket groups are also placed before input. All initial sockets must fit;
startup fails if occupancy, support or a cap would defer one. Legacy groups
without sockets keep their existing wave pacing and visibility checks.

The group's trigger or the existing `spawn-group` script action now releases
its already-present survivors. Their positions, health, inventory and wire IDs
stay intact. Repeated release is a no-op; killed members, including an entire
pre-destroyed tank group, never respawn. Ordinary hitscan/blast damage and
replication apply while dormant. Perception, brains, movement, gun use, capture,
lever jobs and vehicle weapons wait for release. Tank cannon cadence begins
from release, rather than from its earlier placement.

An infantry socket may add `advance`, a 2–64-point one-way 3D feet route. It
requires `staged: true`, cannot also have `patrol`, and starts at the exact
socket. For example, add this to a staged rifleman's socket:

```json
"advance": [
  { "x": 28, "y": 8, "z": 440 },
  { "x": 32, "y": 8, "z": 434 },
  { "x": 32, "y": 8, "z": 426 },
  { "x": 20, "y": 8, "z": 426 },
  { "x": 20, "y": 8, "z": 418 },
  { "x": 32, "y": 8, "z": 418 },
  { "x": 32, "y": 8, "z": 412 },
  { "x": 30, "y": 8, "z": 404 }
]
```

Every point needs support/clearance; every forward leg needs a complete real
nav path inside its optional `combatRegion`. The region must include the
reserve room, entire release corridor and destination, with legal floor bands
as described above. Once released, ordinary combat can preempt its advance;
returning to idle resumes the saved leg and ultimately holds the final point.
This leaves existing cover/combat behaviour available around the destination.

Tank sockets use exact `feet` and `face`, validated for full hull/turret support,
clearance, floor bounds and overlap with other socket members. Vehicles use the
group's existing `path`, validated from every socket rather than its legacy
zone centre. Include 3D path heights on an elevated road. A tank needs vehicle
support rather than an infantry nav polygon; infantry `patrol`, `advance` and
`combatRegion` fields are refused on vehicle sockets.

Checkpoints keep dormant state, per-member advance leg, tank drive progress,
spawner placement/release and event one-shot flags/pending timers. Restore
happens before fresh initialization, so retry, host reload and reconnect cannot
create a second population. Dead remap sentinels are serialized as zero, keeping
subsequent JSON saves valid. Full mission restart rebuilds all initial members.

Reproduce the 32-guard + four-reserve + tank + POW plan at both budgets, actual
nav movement, damage, visible release, saves, ready-up and reconnect:

```sh
corepack pnpm exec vitest run packages/shared/src/sim/stagedEncounter.test.ts packages/server/src/ai/director/stagedSpawner.test.ts packages/tools/src/nav/stagedReserves.test.ts
```

This engine fixture does not author the replacement production map. Reserve
screening/positions, final mission script integration and owner map/play quality
review remain in U-114–U-117/U-119; no production bake inputs changed.

## Checkpoint revisions and original run starts (U-135)

World and level files accept optional `mapRevision`, a positive safe integer.
Omitting it means content revision **1**, independently of level `format` or
checkpoint-world `version`. Increment it when geometry, mission objectives,
encounters or event scripts change in a way that invalidates saved state.
The replacement Qalat level must author `"mapRevision": 2` when its new content
lands; the current production level remains revision 1.

New campaign checkpoints save that revision and `missionStart`, containing
six slot-ordered original loadouts and the original `captured` list of
`{ slot, at: { x, y, z } }` records. The full checkpoint world still holds
spent inventory, current 3D positions and placed devices; event data still holds
fired flags and armed timers. Lobby baseline capture happens at ready-up after
loadout setup. Retry restores checkpoint inventory, while full restart after
JSON/SQLite reload restores the original inventory and prisoners. Replay starts
are kept separately from the campaign's carry-over loadouts and prisoner pool.

These additive fields retain campaign/database format 1. A saved checkpoint
without `mapRevision` has **unknown** provenance; resaving its existing state
does not stamp it with the current revision. Another mission/run's checkpoint
is carried unchanged. Malformed revisions/start snapshots fail durable save
validation without replacing the last acknowledged state; legacy saves lacking
these fields remain parseable and retain their existing fallback.

[U-136](backlog/U-136.md) retains aggregate incompatible-restore acceptance.
[U-143](backlog/U-143.md) supplies quarantine and host choices;
[U-144](backlog/U-144.md) retains the carried-prisoner placement blocker. The
complete [U-113](backlog/U-113.md) acceptance remains open. Cache checkpoint stock
is U-133 in unmerged [#311](https://github.com/JoshuaLRay/Sandline/pull/311).

Reproduce shared content validation, real SQLite reopen and Session save/start
lifecycle regressions:

```sh
pnpm exec vitest run packages/shared/src/sim/mapRevision.test.ts packages/server/src/persistence/checkpointRevision.test.ts packages/server/src/session/checkpointRevision.test.ts packages/server/src/session/checkpointWorld.test.ts packages/server/src/session/loadoutCarry.test.ts packages/server/src/session/runChoice.test.ts packages/server/src/session/elevatedStarts.test.ts packages/server/src/persistence/CampaignDatabase.test.ts
```

## Incompatible restore choices (U-143)

An active mission/run checkpoint restores only when its explicit `mapRevision`
matches current content. Missing revisions are unknown. Refused saves stay
outside the simulation: neither old world state nor a fresh encounter is
initialized, and ready-up, input, timers, reconnect and host changes cannot
bypass the decision. This also applies when the encounter/AI runtime is disabled.

The desktop/mobile dialog says **“This mission map has changed. Restart the
mission to continue.”** The lowest-numbered seated human controls restart or
mission select under the existing campaign rules. Restart uses current authored
starts and original inventory; legacy saves explicitly fall back to pre-mission
carry-over/class inventory. An acknowledged lobby restart writes a current
basic start and still waits for ready-up, preserving inventory through reload.
Selecting another run preserves the refused checkpoint, both prisoner pools and
campaign progress. Other mission/run checkpoints are carried unchanged.

Restart remains unavailable when the original active pool contains prisoners:
current content has no authored holding-socket contract for carried squad slots.
The dialog explains this and retains mission select/Leave room; it never installs
old prisoner coordinates or guesses new holding positions. U-144 must provide
approved placements before U-136/U-113 can close. Mission 1's seventh escort POW
is separate from the captured squad pool.

The validated combined contract is protocol **68**: U-133's supply messages use
event variants **10–12** and `RestoreGate` uses variant **13**. The older separate
cache/restore layouts used versions 66/67 and are rejected by the version gate.
No generated map, asset, audio or nav inputs changed here.

Reproduce Session/wire/client coverage and the responsive dialog captures:

```sh
pnpm exec vitest run packages/shared/src/net/restoreWire.test.ts packages/server/src/session/incompatibleRestore.test.ts packages/server/src/session/checkpointRevision.test.ts packages/client/src/net/incompatibleRestore.test.ts packages/client/src/ui/restoreChoice.test.ts
pnpm exec vitest run --config vitest.browser.config.ts --project assets-browsers packages/client/src/ui/restoreChoice.browser.test.ts
```

The browser run writes 1280/360 px captures to `docs/backlog/evidence/`.
Install the pinned Playwright Chromium, or set `CHROMIUM_PATH` to an available
Chromium executable. Owner desktop/physical-phone UI acceptance remains pending;
the selected card records review steps and the placement limitation.
