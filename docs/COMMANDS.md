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
| `pnpm test:parity-browsers` | parity on Firefox + WebKit (needs `playwright install firefox webkit`) |

## Adding a mission (U-073)

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

Choose **The Qalat Road** in the lobby or open `?mission&world=qalat-road`. This is the live rescue/escort/tank mission from U-093/U-094/U-095. Start and extraction are `(0, -6)`; compound centre is `(0, 182)`.

Walk each lane north and south. The riverbed at x=-40 stays at 0 m with shallow 0.75 m sills near z=32 and z=158. Road banks at x=-20 and x=19 rise to 1 m, flanking the unchanged tank corridor at x=0/8. Eastern fields occupy x=25..57: 1 m at z=24..76, 2 m at z=80..128 and 3.25 m at z=133..174. Broad 0.25 m steps join them; the northern descent ends at z=186. Approach the compound east gate via `(40, 188)` and `(22, 182)`. Observe the gate from the west edge of the upper terrace `(26, 164)`, not from behind the terrace's own lip. The former isolated overlooks are replaced by connected fields.

For the walk-through: cross the southern river sill, climb either road bank, walk the terrace steps through all three elevations, descend north to the east gate, free the POW, order him back along each lane, destroy the scripted tank and extract all seven at the south. Compare sight lines from river `(−40, 60)`, bank `(19, 110)` and upper terrace `(26, 164)`. Owner gameplay and visual review remain pending.

`SANDLINE_LOAD_WORLD=qalat-road pnpm check:load-time` tests the 4 Mbit/s, 30 s budget. `pnpm exec tsx packages/tools/src/level-check.ts` validates authored geometry/routes and writes schematic renders. After a client build, `pnpm exec tsx packages/tools/src/capture-map-review.ts` captures production client views at ground and elevated positions; streaming CI uploads `qalat-map-review` with those PNGs. These are actual client renders with a QA camera, not an owner playtest verdict.
