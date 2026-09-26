# Development and QA commands

On-demand reference moved from `CLAUDE.md`; consult only relevant rows.
Paths in command descriptions such as `client/`, `tools/` and `data/` are
package-relative (`packages/client`, `packages/tools`, `packages/shared/src/data`).

| Command | What it does |
|---|---|
| `pnpm verify` | typecheck + lint + test — the gate every task must pass |
| `pnpm host` | authoritative session host — six slots, real WebSocket |
| `LINK_LATENCY_MS=100 LINK_JITTER_MS=20 LINK_LOSS=0.05 pnpm host` | same host with link sliders on the wire — latency counts **each way** |
| `pnpm --filter @sandline/client dev` | renderer dev server at localhost:5173 |
| `pnpm bot --count 2 --ticks 600` | netcode check in-process on a virtual clock |
| `pnpm bot --url ws://localhost:8080 --count 2 --ticks 600` | same bots over real sockets; numbers should match the line above |
| `pnpm bot --url ws://localhost:8080 --room K7PM --count 1` | a bot into a room people are in |
| `?host=ws://…&room=K7PM` | pre-fills the lobby |
| `?qa` | the QA layer — the readout, tuning panels and netgraph — shown from the start; without it the page is the game (the demo face, T-5.07) and H brings the layer back |
| `?enemies` | three riflemen on the in-page range (one standing, two patrolling), respawned after each despawn |
| `?squad` | the in-page bots run the `friendly` tree with the range's cover: they follow in formation, fight, and take orders — hold Q for the wheel (the mouse picks, 1–6 a slot, 7–8 a fireteam, 0 everyone; release to order), tap F to mark; add `&suppress` or `&enemies` for someone to attack |
| `?suppress` | a rifleman on the in-page range firing past your camera at the squadmate beside you — the suppression vignette, desaturation, jolt and crosshair |
| `MAX_ROOMS=4 ROOM_GRACE_MS=60000 pnpm host` | rooms per process and how long an empty room lives |
| `WORLD=range pnpm host` | the named world every room is built with (`data/worlds/*.json` and, since T-4.09, the levels in `data/levels/*.json`): `range` (the default) or `greybox-01`, the mission map (T-3.31), now the first level |
| `?assets` | every asset in the manifest through the real loader and decoders, stood in a row behind the spawn line (turn round); a grey box is one that failed, and the console says why (T-4.05) |
| `?codeweapons` | the old code-built weapon models instead of the generated period weapons (T-4.36): the squad's M4, DMR, shotgun, pistol, M67, AT4 and M249, and the enemy's AK, PKM and RPG-7 |
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
| `pnpm sim-run --scenario squad` | five friendly bots and a human lead against three riflemen over 10 seeds; reports and asserts kills, no friendly hits, bots downed and revived (T-3.26) |
| `pnpm sim-run --scenario mission --seeds 20` | six friendly bots play the grey-box mission at the director's one- and six-human budgets; reports completion rate and time, enemies under fire in cover, suppression episodes per engagement, and AI cost at 40 enemies and 5 bots; asserts the floors in `scenarios/mission.json` (completion only over 10+ seeds). CI runs `--seeds 3` (T-3.35) |
| `pnpm sim-run --scenario mission --all-missions --seeds 3` | discover every JSON in `packages/shared/src/data/missions/`, play three seeds at both budgets, and report completion or the stopped objective and reason per mission. Gameplay losses are warnings (B-11); invalid files and runner errors fail. Use `--mission path/to/mission.json` for any individual mission file (T-4.17) |
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
| `pnpm test:parity-browsers` | parity on Firefox + WebKit (needs `playwright install firefox webkit`) |
